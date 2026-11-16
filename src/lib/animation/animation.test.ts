import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDemoSkinnedCharacter } from './demoRig';
import { inspectObject3D, discoverFingerChains, evaluateClipCompatibility } from './rigInspect';
import { captureRestPose, applyBoneRotationsFromRest, solveTwoBoneLimbAngles } from './poseIk';
import {
  retargetPoseAcrossRigs,
  solveMultiViewPoseForMannequin,
  solveReferenceSlotsToBoneRotations,
} from './retarget';
import { samplePoseKeyframesAtTime } from './timeline';
import { applyStudioMaterialMode, restoreOriginalMaterials } from './materials';
import {
  processRgbaPixelsToMangaPasses,
  packFilesToZip,
  exportPoseOrClipToBvh,
  compositeRgbaOver,
  compositePositionedRgbaOver,
  computeForegroundPlacementRect,
  computeRgbaOpaqueCenter,
  computeCameraPresetForSubject,
} from './raster';
import {
  applyAnimeToonShaderToRoot,
  downsampleRgbaBilinear,
  renderJapaneseAnimeMangaPasses,
  stylizeBackgroundForAnime,
} from './animeShader';
import {
  ANIME_SHADER_PRESET_CATALOG,
  getAnimeShaderPresetDefaults,
  validateRasterSettings,
  createDefaultFingerControls,
} from '../../../shared/pose-raster';

test('demo humanoid rig builds real skinned mesh, articulated fingers, and built-in clips', () => {
  const bundle = createDemoSkinnedCharacter('demo');
  const diag = inspectObject3D(bundle.root, bundle.clips);
  assert.equal(diag.hasSkinWeights, true);
  assert.equal(diag.hasArticulatedFingers, true);
  assert.ok(diag.boneCount >= 30);
  assert.equal(diag.embeddedClipCount, 4);

  const fingers = discoverFingerChains(bundle.skeleton.bones);
  assert.equal(fingers.left.index.length, 2);
  assert.equal(fingers.right.thumb.length, 2);

  // Verify built-in clip binds tracks cleanly
  const clipReport = evaluateClipCompatibility(bundle.clips[1], bundle.root, 'preset');
  assert.equal(clipReport.compatible, true);
  assert.ok(clipReport.boundTrackCount > 0);
});

test('static unrigged mesh reports missing skin weights warning', () => {
  const staticGroup = new THREE.Group();
  staticGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  const diag = inspectObject3D(staticGroup, []);
  assert.equal(diag.hasSkinWeights, false);
  assert.ok(diag.warnings.some((w) => w.includes('no skin weights')));
});

test('rotating LeftForeArm actually deforms bound SkinnedMesh vertex via boneTransform', () => {
  const bundle = createDemoSkinnedCharacter('demo');
  const restPose = captureRestPose(bundle.root);
  bundle.root.updateMatrixWorld(true);
  bundle.skeleton.update();

  // Find a vertex strongly weighted to LeftHand (bone attached after LeftForeArm)
  const geo = bundle.skinnedMesh.geometry;
  const posAttr = geo.getAttribute('position');
  const siAttr = geo.getAttribute('skinIndex');
  const swAttr = geo.getAttribute('skinWeight');
  const handBoneIdx = bundle.skeleton.bones.findIndex((b) => b.name === 'LeftHand');
  assert.ok(handBoneIdx >= 0);

  let sampleVertexIndex = -1;
  for (let i = 0; i < posAttr.count; i++) {
    if (siAttr.getX(i) === handBoneIdx && swAttr.getX(i) > 0.9) {
      sampleVertexIndex = i;
      break;
    }
  }
  assert.ok(sampleVertexIndex >= 0);

  const vRest = new THREE.Vector3();
  bundle.skinnedMesh.getVertexPosition(sampleVertexIndex, vRest);

  // Rotate LeftForeArm elbow by 90 deg
  applyBoneRotationsFromRest(bundle.root, restPose, {
    LeftForeArm: { x: 0, y: Math.PI / 2, z: 0 },
  });
  bundle.skeleton.update();

  const vBent = new THREE.Vector3();
  bundle.skinnedMesh.getVertexPosition(sampleVertexIndex, vBent);

  const movedDist = vRest.distanceTo(vBent);
  assert.ok(movedDist > 0.15, `Expected hand vertex to move >= 0.15m on elbow bend, moved ${movedDist}`);
});

test('finger controls safely deform finger bones and report missing bones on simple skeletons', () => {
  const bundle = createDemoSkinnedCharacter('demo');
  const restPose = captureRestPose(bundle.root);
  const fc = createDefaultFingerControls();
  fc.left.curl = 1.1;

  const res = applyBoneRotationsFromRest(bundle.root, restPose, {}, fc);
  assert.equal(res.missingFingerBones.length, 0);

  const index1 = bundle.skeleton.bones.find((b) => b.name === 'LeftHandIndex1')!;
  const euler = new THREE.Euler().setFromQuaternion(index1.quaternion);
  assert.ok(Math.abs(euler.z) > 0.5);
});

test('two-bone IK solver respects bend limits and solves reach ratio', () => {
  const solved = solveTwoBoneLimbAngles({
    rootPos: { x: 0.2, y: 1.4, z: 0 },
    midPos: { x: 0.44, y: 1.4, z: 0 },
    endPos: { x: 0.68, y: 1.4, z: 0 },
    targetPos: { x: 0.45, y: 1.25, z: 0.25 },
    respectBendLimits: true,
    limbKind: 'arm',
  });
  assert.ok(solved.reachRatio > 0 && solved.reachRatio <= 1);
  assert.ok(Math.abs(solved.lowerDelta.y) <= 2.46);
});

test('mannequin driver retargeting preserves target bone lengths and copies mapped joint angles', () => {
  const driver = createDemoSkinnedCharacter('mannequin');
  const target = createDemoSkinnedCharacter('demo');
  const targetHeadPosBefore = target.skeleton.bones.find((b) => b.name === 'Head')!.position.clone();

  const report = retargetPoseAcrossRigs(
    driver.root,
    {
      LeftUpperArm: { x: 0.2, y: 0, z: -0.9 },
      LeftForeArm: { x: 0, y: -0.8, z: 0 },
      Spine: { x: 0.15, y: 0.1, z: 0 },
    },
    target.root
  );

  assert.equal(report.mappedCount, 3);
  assert.ok(Math.abs(report.rotations.LeftForeArm.x) < 1e-5);
  assert.ok(Math.abs(report.rotations.LeftForeArm.y - -0.8) < 1e-5);
  assert.ok(Math.abs(report.rotations.LeftForeArm.z) < 1e-5);
  const targetHeadPosAfter = target.skeleton.bones.find((b) => b.name === 'Head')!.position;
  assert.equal(targetHeadPosBefore.distanceTo(targetHeadPosAfter), 0);
});

test('retargetPoseAcrossRigs aligns A-pose Mixamo/FBX rig with +Y-along-bone local axes to mannequin world pose', () => {
  const driver = createDemoSkinnedCharacter('mannequin');
  const driverRest = captureRestPose(driver.root);

  // Build synthetic uploaded Mixamo/VRM-style rig with A-pose (-40 deg downward arms) and +Y bone axes
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'mixamorig:Hips';
  hips.position.set(0, 0.95, 0);
  const spine = new THREE.Bone();
  spine.name = 'mixamorig:Spine';
  spine.position.set(0, 0.14, 0);
  const chest = new THREE.Bone();
  chest.name = 'mixamorig:Spine2';
  chest.position.set(0, 0.18, 0);
  const head = new THREE.Bone();
  head.name = 'mixamorig:Head';
  head.position.set(0, 0.22, 0);

  // Left shoulder & A-pose +Y-along-bone upper arm/forearm/hand
  const lShoulder = new THREE.Bone();
  lShoulder.name = 'mixamorig:LeftShoulder';
  lShoulder.position.set(0.06, 0.16, 0);

  // Rotate local +Y to point 40 deg down-left (+X, -Y)
  const lArm = new THREE.Bone();
  lArm.name = 'mixamorig:LeftArm';
  lArm.position.set(0.12, 0, 0);
  lArm.quaternion.setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2 - 0.7));

  const lForeArm = new THREE.Bone();
  lForeArm.name = 'mixamorig:LeftForeArm';
  lForeArm.position.set(0, 0.26, 0); // local +Y runs down the arm!

  const lHand = new THREE.Bone();
  lHand.name = 'mixamorig:LeftHand';
  lHand.position.set(0, 0.24, 0);

  // Mirror for Right arm (-X, -Y A-pose, +Y along bone)
  const rShoulder = new THREE.Bone();
  rShoulder.name = 'mixamorig:RightShoulder';
  rShoulder.position.set(-0.06, 0.16, 0);

  const rArm = new THREE.Bone();
  rArm.name = 'mixamorig:RightArm';
  rArm.position.set(-0.12, 0, 0);
  rArm.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2 + 0.7));

  const rForeArm = new THREE.Bone();
  rForeArm.name = 'mixamorig:RightForeArm';
  rForeArm.position.set(0, 0.26, 0);

  const rHand = new THREE.Bone();
  rHand.name = 'mixamorig:RightHand';
  rHand.position.set(0, 0.24, 0);

  // Twist bone that must be ignored cleanly by role mapper
  const lArmTwist = new THREE.Bone();
  lArmTwist.name = 'mixamorig:LeftArmTwist';
  lArmTwist.position.set(0, 0.13, 0);

  hips.add(spine);
  spine.add(chest);
  chest.add(head, lShoulder, rShoulder);
  lShoulder.add(lArm);
  lArm.add(lArmTwist, lForeArm);
  lForeArm.add(lHand);
  rShoulder.add(rArm);
  rArm.add(rForeArm);
  rForeArm.add(rHand);
  root.add(hips);
  root.updateMatrixWorld(true);

  const targetRest = captureRestPose(root);

  // Driver aims both arms forward & elbows bent up (guard / pistol stance)
  const driverRot = {
    Spine: { x: 0.08, y: -0.1, z: 0 },
    LeftUpperArm: { x: -0.2, y: -1.25, z: -0.35 },
    LeftForeArm: { x: 0, y: -1.1, z: 0.65 },
    RightUpperArm: { x: -0.2, y: 1.25, z: 0.35 },
    RightForeArm: { x: 0, y: 1.1, z: -0.65 },
  };

  // Pre-dirty target pose to ensure retargetPoseAcrossRigs measures strictly from targetRest
  lArm.rotation.z += 0.5;
  root.updateMatrixWorld(true);

  const report = retargetPoseAcrossRigs(driver.root, driverRot, root, targetRest, driverRest);
  assert.equal(report.mappedCount, 5);
  assert.ok(report.rotations['mixamorig:LeftArm']);
  assert.ok(!report.rotations['mixamorig:LeftArmTwist']);

  // Measure world arm directions on posed driver vs retargeted A-pose Mixamo target
  applyBoneRotationsFromRest(driver.root, driverRest, driverRot);
  applyBoneRotationsFromRest(root, targetRest, report.rotations);

  const worldDir = (a: THREE.Object3D, b: THREE.Object3D) => {
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    a.getWorldPosition(p0);
    b.getWorldPosition(p1);
    return p1.sub(p0).normalize();
  };

  const srcLArm = worldDir(
    driver.root.getObjectByName('LeftUpperArm')!,
    driver.root.getObjectByName('LeftForeArm')!
  );
  const tgtLArm = worldDir(lArm, lForeArm);
  assert.ok(
    srcLArm.dot(tgtLArm) > 0.97,
    `Expected left upper arm world direction dot > 0.97, got ${srcLArm.dot(tgtLArm).toFixed(3)}`
  );

  const srcLFore = worldDir(
    driver.root.getObjectByName('LeftForeArm')!,
    driver.root.getObjectByName('LeftHand')!
  );
  const tgtLFore = worldDir(lForeArm, lHand);
  assert.ok(
    srcLFore.dot(tgtLFore) > 0.97,
    `Expected left forearm world direction dot > 0.97, got ${srcLFore.dot(tgtLFore).toFixed(3)}`
  );

  const srcRFore = worldDir(
    driver.root.getObjectByName('RightForeArm')!,
    driver.root.getObjectByName('RightHand')!
  );
  const tgtRFore = worldDir(rForeArm, rHand);
  assert.ok(
    srcRFore.dot(tgtRFore) > 0.97,
    `Expected right forearm world direction dot > 0.97, got ${srcRFore.dot(tgtRFore).toFixed(3)}`
  );
});

test('reference landmark solver produces humanoid rotations and reports missing legs honestly', () => {
  const target = createDemoSkinnedCharacter('demo');
  const solved = solveReferenceSlotsToBoneRotations(
    target.root,
    [
      {
        view: 'front',
        imageUrl: 'data:image/png;base64,AA==',
        imageName: 'ref.png',
        landmarks: [
          { index: 0, name: 'Nose', x: 0.5, y: 0.15, z: 0, visibility: 0.9 },
          { index: 11, name: 'LShoulder', x: 0.6, y: 0.3, z: 0, visibility: 0.9 },
          { index: 12, name: 'RShoulder', x: 0.4, y: 0.3, z: 0, visibility: 0.9 },
          { index: 13, name: 'LElbow', x: 0.72, y: 0.38, z: 0, visibility: 0.88 },
          { index: 14, name: 'RElbow', x: 0.28, y: 0.42, z: 0, visibility: 0.88 },
          { index: 15, name: 'LWrist', x: 0.75, y: 0.28, z: 0, visibility: 0.85 },
          { index: 16, name: 'RWrist', x: 0.25, y: 0.52, z: 0, visibility: 0.85 },
          { index: 23, name: 'LHip', x: 0.55, y: 0.55, z: 0, visibility: 0.9 },
          { index: 24, name: 'RHip', x: 0.45, y: 0.55, z: 0, visibility: 0.9 },
        ],
        confidenceMean: 0.88,
        missingJoints: [],
        samePoseConfirmed: true,
        detectionSource: 'mediapipe_image',
      },
    ],
    'front'
  );
  assert.ok(solved.mappedJointsCount >= 4);
  assert.ok(solved.missingJoints.includes('Left Leg'));
});

test('solveMultiViewPoseForMannequin fuses Front, Side, and Rear landmarks onto built-in mannequin driver', () => {
  const mannequin = createDemoSkinnedCharacter('mannequin');
  const result = solveMultiViewPoseForMannequin(mannequin.root, [
    {
      view: 'front',
      imageUrl: 'data:image/png;base64,AA==',
      imageName: 'front.png',
      landmarks: [
        { index: 0, name: 'Nose', x: 0.5, y: 0.15, z: 0, visibility: 0.95 },
        { index: 11, name: 'LShoulder', x: 0.58, y: 0.28, z: 0, visibility: 0.95 },
        { index: 12, name: 'RShoulder', x: 0.42, y: 0.28, z: 0, visibility: 0.95 },
        { index: 13, name: 'LElbow', x: 0.64, y: 0.24, z: 0, visibility: 0.92 },
        { index: 14, name: 'RElbow', x: 0.34, y: 0.42, z: 0, visibility: 0.92 },
        { index: 15, name: 'LWrist', x: 0.62, y: 0.16, z: 0, visibility: 0.9 },
        { index: 16, name: 'RWrist', x: 0.31, y: 0.54, z: 0, visibility: 0.9 },
        { index: 23, name: 'LHip', x: 0.55, y: 0.54, z: 0, visibility: 0.95 },
        { index: 24, name: 'RHip', x: 0.45, y: 0.54, z: 0, visibility: 0.95 },
        { index: 25, name: 'LKnee', x: 0.56, y: 0.72, z: 0, visibility: 0.92 },
        { index: 26, name: 'RKnee', x: 0.44, y: 0.73, z: 0, visibility: 0.92 },
        { index: 27, name: 'LAnkle', x: 0.56, y: 0.9, z: 0, visibility: 0.9 },
        { index: 28, name: 'RAnkle', x: 0.44, y: 0.92, z: 0, visibility: 0.9 },
      ],
      confidenceMean: 0.93,
      missingJoints: [],
      samePoseConfirmed: true,
      detectionSource: 'mediapipe_image',
    },
    {
      view: 'side',
      imageUrl: 'data:image/png;base64,AA==',
      imageName: 'side.png',
      landmarks: [
        { index: 0, name: 'Nose', x: 0.54, y: 0.15, z: 0, visibility: 0.9 },
        { index: 11, name: 'LShoulder', x: 0.5, y: 0.28, z: 0, visibility: 0.9 },
        { index: 12, name: 'RShoulder', x: 0.5, y: 0.28, z: 0, visibility: 0.85 },
        { index: 13, name: 'LElbow', x: 0.62, y: 0.24, z: 0, visibility: 0.9 },
        { index: 15, name: 'LWrist', x: 0.68, y: 0.16, z: 0, visibility: 0.9 },
        { index: 23, name: 'LHip', x: 0.5, y: 0.54, z: 0, visibility: 0.9 },
        { index: 25, name: 'LKnee', x: 0.58, y: 0.72, z: 0, visibility: 0.9 },
        { index: 27, name: 'LAnkle', x: 0.46, y: 0.9, z: 0, visibility: 0.9 },
      ],
      confidenceMean: 0.9,
      missingJoints: [],
      samePoseConfirmed: true,
      detectionSource: 'mediapipe_image',
    },
    {
      view: 'back',
      imageUrl: 'data:image/png;base64,AA==',
      imageName: 'rear.png',
      landmarks: [
        { index: 11, name: 'LShoulder', x: 0.42, y: 0.28, z: 0, visibility: 0.92 },
        { index: 12, name: 'RShoulder', x: 0.58, y: 0.28, z: 0, visibility: 0.92 },
        { index: 13, name: 'LElbow', x: 0.36, y: 0.24, z: 0, visibility: 0.9 },
        { index: 14, name: 'RElbow', x: 0.66, y: 0.42, z: 0, visibility: 0.9 },
        { index: 23, name: 'LHip', x: 0.45, y: 0.54, z: 0, visibility: 0.92 },
        { index: 24, name: 'RHip', x: 0.55, y: 0.54, z: 0, visibility: 0.92 },
      ],
      confidenceMean: 0.91,
      missingJoints: [],
      samePoseConfirmed: true,
      detectionSource: 'mediapipe_image',
    },
  ]);

  assert.deepEqual(result.usedViews, ['front', 'side', 'back']);
  assert.ok(result.mappedBonesCount >= 8);
  assert.ok(result.rotations.LeftUpperArm);
  assert.ok(result.rotations.LeftForeArm);
  assert.ok(result.rotations.LeftLeg);
  // Left knee is bent back in side view -> LeftLeg.x > 0.2 rad
  assert.ok(result.rotations.LeftLeg.x > 0.2);
});

test('pose keyframe sampler deterministically interpolates via SLERP', () => {
  const sample = samplePoseKeyframesAtTime(
    [
      { id: 'k1', timeSec: 0, label: 'Start', boneRotations: { LeftForeArm: { x: 0, y: 0, z: 0 } } },
      { id: 'k2', timeSec: 2, label: 'End', boneRotations: { LeftForeArm: { x: 0, y: 1.0, z: 0 } } },
    ],
    1.0
  );
  assert.ok(Math.abs(sample.LeftForeArm.y - 0.5) < 0.02);
});

test('material mode switcher preserves and restores original materials', () => {
  const bundle = createDemoSkinnedCharacter('demo');
  const cache = new WeakMap<THREE.Mesh, { material: THREE.Material | THREE.Material[] }>();
  const origName = (bundle.skinnedMesh.material as THREE.Material).name;

  applyStudioMaterialMode(bundle.root, cache, {
    mode: 'wire',
    tintHex: '#ffffff',
    roughness: 0.5,
    metalness: 0.1,
    showSkeleton: false,
  });
  assert.ok((bundle.skinnedMesh.material as THREE.MeshBasicMaterial).wireframe);

  restoreOriginalMaterials(bundle.root, cache);
  assert.equal((bundle.skinnedMesh.material as THREE.Material).name, origName);
});

test('raster manga pass generator, ZIP packer, and BVH exporter produce non-empty outputs', () => {
  // 4x4 synthetic RGBA image with opaque colored 2x2 center square
  const w = 4;
  const h = 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 1; y <= 2; y++) {
    for (let x = 1; x <= 2; x++) {
      const p = (y * w + x) * 4;
      rgba[p] = 220;
      rgba[p + 1] = 140;
      rgba[p + 2] = 160;
      rgba[p + 3] = 255;
    }
  }
  const passes = processRgbaPixelsToMangaPasses(w, h, rgba, validateRasterSettings({ exteriorLineWidth: 2 }));
  assert.ok(passes.linePass.some((v) => v > 0));
  assert.ok(passes.colorPass.some((v) => v > 0));

  const zipBytes = packFilesToZip({ 'manifest.json': '{"studio":"RAPUSO"}' });
  assert.ok(zipBytes.length > 20);
  // ZIP PK header bytes
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);

  const bundle = createDemoSkinnedCharacter('demo');
  const bvh = exportPoseOrClipToBvh(bundle.root, 2, 1 / 30);
  assert.ok(bvh.includes('HIERARCHY'));
  assert.ok(bvh.includes('ROOT Hips'));
  assert.ok(bvh.includes('Frames: 2'));
});

test('applyBoneRotationsFromRest applies bonePositions offsets cleanly from rest pose', () => {
  const bundle = createDemoSkinnedCharacter('demo');
  const restPose = captureRestPose(bundle.root);
  const headRestPos = restPose.positions.get('Head')!.clone();

  applyBoneRotationsFromRest(
    bundle.root,
    restPose,
    {},
    undefined,
    {
      Head: { x: 0.05, y: 0.12, z: -0.04 },
    }
  );

  const headBone = bundle.skeleton.bones.find((b) => b.name === 'Head')!;
  assert.ok(Math.abs(headBone.position.x - (headRestPos.x + 0.05)) < 1e-5);
  assert.ok(Math.abs(headBone.position.y - (headRestPos.y + 0.12)) < 1e-5);
  assert.ok(Math.abs(headBone.position.z - (headRestPos.z - 0.04)) < 1e-5);

  // Clearing bonePositions restores exact rest position
  applyBoneRotationsFromRest(bundle.root, restPose, {}, undefined, {});
  assert.ok(headBone.position.distanceTo(headRestPos) < 1e-6);
});

test('retargetPoseAcrossRigs transfers bone node position offsets into differing target parent space', () => {
  const driver = createDemoSkinnedCharacter('mannequin');
  const driverRest = captureRestPose(driver.root);

  // Target with rotated parent chest so local bone axes differ from driver
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'Hips';
  hips.position.set(0, 1, 0);
  const chest = new THREE.Bone();
  chest.name = 'Spine2';
  chest.position.set(0, 0.3, 0);
  chest.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.set(0, 0.2, 0);
  hips.add(chest);
  chest.add(head);
  root.add(hips);
  root.updateMatrixWorld(true);
  const targetRest = captureRestPose(root);

  const report = retargetPoseAcrossRigs(
    driver.root,
    {},
    root,
    targetRest,
    driverRest,
    { Head: { x: 0.15, y: 0.05, z: 0 } }
  );

  assert.ok(report.positions.Head);
  applyBoneRotationsFromRest(root, targetRest, report.rotations, undefined, report.positions);
  root.updateMatrixWorld(true);

  const restWorld = new THREE.Vector3();
  const movedWorld = new THREE.Vector3();
  root.traverse((obj) => {
    if (obj.name === 'Head') obj.getWorldPosition(movedWorld);
  });
  // Re-apply empty positions to inspect rest world position
  applyBoneRotationsFromRest(root, targetRest, {}, undefined, {});
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.name === 'Head') obj.getWorldPosition(restWorld);
  });

  const worldDelta = movedWorld.sub(restWorld);
  assert.ok(Math.abs(worldDelta.x - 0.15) < 1e-3, `Expected world +X shift ~0.15, got ${worldDelta.x}`);
  assert.ok(Math.abs(worldDelta.y - 0.05) < 1e-3, `Expected world +Y shift ~0.05, got ${worldDelta.y}`);
});

test('computeCameraPresetForSubject supports zoom, orbit yaw/pitch, roll, and vertical pan', () => {
  const bundle = createDemoSkinnedCharacter('demo');
  const base = computeCameraPresetForSubject(bundle.root, 'front');
  const zoomedIn = computeCameraPresetForSubject(bundle.root, 'front', { cameraZoom: 2.0 });
  const baseDist = base.position.distanceTo(base.target);
  const zoomedDist = zoomedIn.position.distanceTo(zoomedIn.target);
  assert.ok(Math.abs(zoomedDist - baseDist / 2) < 1e-4);

  const orbited = computeCameraPresetForSubject(bundle.root, 'front', {
    cameraOrbitYawDeg: 90,
    cameraOrbitPitchDeg: 20,
    cameraRollDeg: 45,
    cameraPanY: 0.4,
  });
  assert.ok(orbited.target.y > base.target.y);
  // 90 deg yaw from front (+Z) rotates camera toward +X
  assert.ok(orbited.position.x > orbited.target.x + 0.5);
  // 45 deg roll tilts up vector away from vertical
  assert.ok(Math.abs(orbited.up.x) > 0.1 || Math.abs(orbited.up.z) > 0.1);
});

test('compositeRgbaOver performs Porter-Duff source-over compositing', () => {
  const fg = new Uint8ClampedArray([200, 100, 50, 255, 0, 0, 0, 0]);
  const bg = new Uint8ClampedArray([10, 20, 30, 255, 40, 80, 120, 255]);
  const out = compositeRgbaOver(fg, bg);
  assert.deepEqual(Array.from(out), [200, 100, 50, 255, 40, 80, 120, 255]);
});

test('solveMultiViewPoseForMannequin uses normalized MediaPipe z-depth on front-only view', () => {
  const mannequin = createDemoSkinnedCharacter('mannequin');
  const restMannequin = captureRestPose(mannequin.root);
  const result = solveMultiViewPoseForMannequin(mannequin.root, [
    {
      view: 'front',
      imageUrl: 'data:image/png;base64,AA==',
      imageName: 'front-forward.png',
      landmarks: [
        { index: 0, name: 'Nose', x: 0.5, y: 0.16, z: 0, visibility: 0.98 },
        { index: 11, name: 'LShoulder', x: 0.58, y: 0.28, z: 0, visibility: 0.98 },
        { index: 12, name: 'RShoulder', x: 0.42, y: 0.28, z: 0, visibility: 0.98 },
        // Negative z in MediaPipe means closer to camera (+Z forward)
        { index: 13, name: 'LElbow', x: 0.56, y: 0.28, z: -0.18, visibility: 0.95 },
        { index: 14, name: 'RElbow', x: 0.44, y: 0.28, z: -0.18, visibility: 0.95 },
        { index: 15, name: 'LWrist', x: 0.52, y: 0.26, z: -0.36, visibility: 0.94 },
        { index: 16, name: 'RWrist', x: 0.48, y: 0.26, z: -0.36, visibility: 0.94 },
        { index: 23, name: 'LHip', x: 0.54, y: 0.54, z: 0, visibility: 0.98 },
        { index: 24, name: 'RHip', x: 0.46, y: 0.54, z: 0, visibility: 0.98 },
      ],
      confidenceMean: 0.96,
      missingJoints: [],
      samePoseConfirmed: true,
      detectionSource: 'mediapipe_image',
    },
  ]);

  applyBoneRotationsFromRest(mannequin.root, restMannequin, result.rotations);
  mannequin.root.updateMatrixWorld(true);
  const lShoulderPos = new THREE.Vector3();
  const lHandPos = new THREE.Vector3();
  mannequin.root.getObjectByName('LeftUpperArm')!.getWorldPosition(lShoulderPos);
  mannequin.root.getObjectByName('LeftHand')!.getWorldPosition(lHandPos);
  // Hand should reach noticeably forward (+Z) relative to shoulder
  assert.ok(lHandPos.z - lShoulderPos.z > 0.2, `Expected LeftHand +Z forward > 0.2, got ${(lHandPos.z - lShoulderPos.z).toFixed(3)}`);
});

test('computeRgbaOpaqueCenter, computeForegroundPlacementRect, and compositePositionedRgbaOver move foreground over fixed background', () => {
  // 4x4 foreground with opaque red pixel at (0, 0)
  const w = 4;
  const h = 4;
  const fg = new Uint8ClampedArray(w * h * 4);
  fg[0] = 250;
  fg[1] = 40;
  fg[2] = 40;
  fg[3] = 255;

  const center = computeRgbaOpaqueCenter(fg, w, h);
  assert.equal(center.x, 0);
  assert.equal(center.y, 0);

  const rect = computeForegroundPlacementRect(100, 100, 0.25, -0.1, 1.5);
  assert.equal(rect.drawW, 150);
  assert.equal(rect.drawH, 150);
  assert.equal(rect.drawX, 0);
  assert.equal(rect.drawY, -35);

  // Solid blue background (10, 20, 220, 255)
  const bg = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < bg.length; i += 4) {
    bg[i] = 10;
    bg[i + 1] = 20;
    bg[i + 2] = 220;
    bg[i + 3] = 255;
  }

  // Shift foreground by +0.5 horizontally (+2px) and +0.5 vertically (+2px)
  const out = compositePositionedRgbaOver(fg, bg, w, h, 0.5, 0.5, 1);
  // Original (0, 0) now shows fixed blue background
  assert.deepEqual(Array.from(out.slice(0, 4)), [10, 20, 220, 255]);
  // Shifted (2, 2) now shows moved red foreground
  const shiftedIdx = (2 * w + 2) * 4;
  assert.deepEqual(Array.from(out.slice(shiftedIdx, shiftedIdx + 4)), [250, 40, 40, 255]);
});

test('getAnimeShaderPresetDefaults configures Japanese market anime and manga presets', () => {
  const shonen = validateRasterSettings(getAnimeShaderPresetDefaults('shonen_manga'));
  assert.equal(shonen.style, 'screentone');
  assert.equal(shonen.inkPenStyle, 'g_pen');
  assert.equal(shonen.backgroundHarmony, 'manga_tone');
  assert.equal(shonen.mangaOverlayEffect, 'manga_border');

  const seinen = validateRasterSettings(getAnimeShaderPresetDefaults('seinen_gekiga'));
  assert.equal(seinen.style, 'monochrome_ink');
  assert.equal(seinen.inkPenStyle, 'fude_brush');
  assert.equal(seinen.mangaOverlayEffect, 'radial_focus');

  const tv = validateRasterSettings(getAnimeShaderPresetDefaults('anime_tv'));
  assert.equal(tv.style, 'colored_cel');
  assert.equal(tv.use3DToonShader, true);
  assert.equal(tv.supersample2x, true);
});

test('applyAnimeToonShaderToRoot swaps to MeshToonMaterial and cleanly restores originals on dispose', () => {
  const bundle = createDemoSkinnedCharacter('demo');
  const origName = (bundle.skinnedMesh.material as THREE.Material).name;
  const origType = (bundle.skinnedMesh.material as THREE.Material).type;
  const cache = new WeakMap<THREE.Mesh, { material: THREE.Material | THREE.Material[] }>();
  const settings = validateRasterSettings({ animeShaderPreset: 'anime_tv', celShadowBands: 3 });

  const session = applyAnimeToonShaderToRoot(bundle.root, cache, settings);
  assert.ok(bundle.skinnedMesh.material instanceof THREE.MeshToonMaterial);

  session.dispose();
  assert.equal((bundle.skinnedMesh.material as THREE.Material).name, origName);
  assert.equal((bundle.skinnedMesh.material as THREE.Material).type, origType);
  assert.ok(!(bundle.skinnedMesh.material instanceof THREE.MeshToonMaterial));
});

test('downsampleRgbaBilinear, renderJapaneseAnimeMangaPasses, and stylizeBackgroundForAnime produce crisp passes', () => {
  // 4x4 -> 2x2 downsample preserves averaged center alpha/color
  const hi = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < hi.length; i += 4) {
    hi[i] = 200;
    hi[i + 1] = 160;
    hi[i + 2] = 180;
    hi[i + 3] = 255;
  }
  const lo = downsampleRgbaBilinear(hi, 4, 4, 2, 2);
  assert.equal(lo.length, 2 * 2 * 4);
  assert.equal(lo[0], 200);
  assert.equal(lo[3], 255);

  // 16x16 opaque character patch + transparent margin for Sobel ink + screentone + shadow tint
  const w = 16;
  const h = 16;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 3; y < 13; y++) {
    for (let x = 4; x < 12; x++) {
      const p = (y * w + x) * 4;
      src[p] = x < 8 ? 65 : 220;
      src[p + 1] = x < 8 ? 60 : 185;
      src[p + 2] = x < 8 ? 72 : 175;
      src[p + 3] = 255;
    }
  }
  const animeSettings = validateRasterSettings(getAnimeShaderPresetDefaults('anime_tv'));
  const celPasses = renderJapaneseAnimeMangaPasses(w, h, src, animeSettings);
  assert.ok(celPasses.linePass.some((v) => v > 0));
  assert.ok(celPasses.shadowPass.some((v) => v > 0));

  const mangaSettings = validateRasterSettings(getAnimeShaderPresetDefaults('shonen_manga'));
  const mangaPasses = renderJapaneseAnimeMangaPasses(w, h, src, mangaSettings);
  // Manga border frame puts opaque ink near margin
  assert.ok(mangaPasses.linePass.some((v) => v > 0));

  const bgRaw = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < bgRaw.length; i += 4) {
    bgRaw[i] = 110;
    bgRaw[i + 1] = 140;
    bgRaw[i + 2] = 180;
    bgRaw[i + 3] = 255;
  }
  const animeBg = stylizeBackgroundForAnime(w, h, bgRaw, animeSettings);
  assert.equal(animeBg.combined.length, bgRaw.length);
  const rawBg = stylizeBackgroundForAnime(w, h, bgRaw, {
    ...animeSettings,
    backgroundHarmony: 'raw_photo',
  });
  assert.equal(rawBg.combined, bgRaw);
});

test('computeCameraPresetForSubject supports wide, full, knee, waist, bust, face framing, panX, and FOV', () => {
  const bundle = createDemoSkinnedCharacter('demo');
  const wide = computeCameraPresetForSubject(bundle.root, 'front', { cameraFraming: 'wide' });
  const full = computeCameraPresetForSubject(bundle.root, 'front', { cameraFraming: 'full' });
  const knee = computeCameraPresetForSubject(bundle.root, 'front', { cameraFraming: 'knee' });
  const waist = computeCameraPresetForSubject(bundle.root, 'front', { cameraFraming: 'waist' });
  const bust = computeCameraPresetForSubject(bundle.root, 'front', { cameraFraming: 'bust' });
  const face = computeCameraPresetForSubject(bundle.root, 'front', { cameraFraming: 'face' });

  // Face target sits higher than bust, bust sits higher than waist, and camera distance scales monotonically
  assert.ok(face.target.y > bust.target.y);
  assert.ok(bust.target.y > waist.target.y);
  assert.ok(
    face.position.distanceTo(face.target) < bust.position.distanceTo(bust.target) &&
      bust.position.distanceTo(bust.target) < waist.position.distanceTo(waist.target) &&
      waist.position.distanceTo(waist.target) < knee.position.distanceTo(knee.target) &&
      knee.position.distanceTo(knee.target) < full.position.distanceTo(full.target) &&
      full.position.distanceTo(full.target) < wide.position.distanceTo(wide.target)
  );

  const panned = computeCameraPresetForSubject(bundle.root, 'front', {
    cameraFraming: 'bust',
    cameraPanX: 0.5,
    cameraFov: 24,
  });
  assert.equal(panned.fov, 24);
  assert.ok(panned.target.x > bust.target.x + 0.05);
});

test('preserveFaceDetails keeps anime eye iris materials unlit/vibrant and protects saturated iris pixels from thick ink', () => {
  const group = new THREE.Group();
  const eyeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.1),
    new THREE.MeshStandardMaterial({ name: 'Anime_Eye_Iris_Green', color: '#44cc66' })
  );
  eyeMesh.name = 'LeftEyeIris';
  group.add(eyeMesh);

  const cache = new WeakMap<THREE.Mesh, { material: THREE.Material | THREE.Material[] }>();
  const settings = validateRasterSettings({
    resolutionWidth: 2048,
    resolutionHeight: 2048,
    preserveFaceDetails: true,
    detailSharpness: 0.7,
    exteriorLineWidth: 4,
  });
  assert.equal(settings.resolutionWidth, 2048);

  const session = applyAnimeToonShaderToRoot(group, cache, settings);
  assert.ok(eyeMesh.material instanceof THREE.MeshBasicMaterial);
  session.dispose();
  assert.ok(eyeMesh.material instanceof THREE.MeshStandardMaterial);

  // 12x12 image with bright green iris pixels & high contrast inner edge must keep green hue intact
  const w = 12;
  const h = 12;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 2; y < 10; y++) {
    for (let x = 2; x < 10; x++) {
      const p = (y * w + x) * 4;
      const isIris = x >= 4 && x <= 7 && y >= 4 && y <= 7;
      src[p] = isIris ? 60 : 245;
      src[p + 1] = isIris ? 210 : 235;
      src[p + 2] = isIris ? 85 : 230;
      src[p + 3] = 255;
    }
  }
  const passes = renderJapaneseAnimeMangaPasses(w, h, src, settings);
  const centerIdx = (5 * w + 5) * 4;
  // Center green iris pixel must retain dominant green channel instead of being blackened out
  assert.ok(passes.combined[centerIdx + 1] > passes.combined[centerIdx] + 40);
});

test('Inspector Shader presets Hard Cel, Halftone Screen, and Ink Outline configure and render distinct Japanese manga passes', () => {
  const featuredIds = ANIME_SHADER_PRESET_CATALOG.filter((p) => p.featuredManga).map((p) => p.id);
  assert.deepEqual(featuredIds, ['hard_cel', 'halftone_screen', 'ink_outline']);

  const hardCel = validateRasterSettings(getAnimeShaderPresetDefaults('hard_cel'));
  assert.equal(hardCel.animeShaderPreset, 'hard_cel');
  assert.equal(hardCel.style, 'colored_cel');
  assert.equal(hardCel.celShadowBands, 2);
  assert.equal(hardCel.inkPenStyle, 'g_pen');

  const halftone = validateRasterSettings(getAnimeShaderPresetDefaults('halftone_screen'));
  assert.equal(halftone.animeShaderPreset, 'halftone_screen');
  assert.equal(halftone.style, 'screentone');
  assert.ok(halftone.screentoneDensity >= 0.7);

  const inkOutline = validateRasterSettings(getAnimeShaderPresetDefaults('ink_outline'));
  assert.equal(inkOutline.animeShaderPreset, 'ink_outline');
  assert.equal(inkOutline.style, 'monochrome_ink');
  assert.equal(inkOutline.inkPenStyle, 'fude_brush');

  // Render same graded color patch with all 3 presets and verify distinct visual styles
  const w = 16;
  const h = 16;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 2; y < 14; y++) {
    for (let x = 2; x < 14; x++) {
      const p = (y * w + x) * 4;
      src[p] = x < 8 ? 105 : 225;
      src[p + 1] = x < 8 ? 82 : 165;
      src[p + 2] = x < 8 ? 140 : 185;
      src[p + 3] = 255;
    }
  }

  const celOut = renderJapaneseAnimeMangaPasses(w, h, src, hardCel);
  const dotOut = renderJapaneseAnimeMangaPasses(w, h, src, halftone);
  const inkOut = renderJapaneseAnimeMangaPasses(w, h, src, inkOutline);

  // Sample interior lit pixel (x=10, y=7) safely inside the 2px dilated outer contour and away from x=8 seam
  const litIdx = (7 * w + 10) * 4;
  assert.ok(
    celOut.combined[litIdx] > celOut.combined[litIdx + 1] + 20,
    'Hard Cel should retain colored cel channels'
  );
  // Halftone Screen & Ink Outline output crisp monochrome luminance channels (R === G === B)
  assert.equal(dotOut.combined[litIdx], dotOut.combined[litIdx + 1]);
  assert.equal(inkOut.combined[litIdx], inkOut.combined[litIdx + 1]);
  // Ink Outline bright midtones stay clean manga paper while dark contours get inked
  assert.ok(inkOut.combined[litIdx] >= 240);
  assert.ok(inkOut.linePass.some((v) => v > 0));
});




