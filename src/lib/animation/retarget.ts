import * as THREE from 'three';
import type { BoneRotationMap } from '../../../shared/studio';
import type { PoseLandmarkPoint, ReferenceImageSlot } from '../../../shared/pose-raster';
import {
  CanonicalBoneRole,
  collectSkeletonBones,
  mapBonesToRoles,
} from './rigInspect';
import {
  applyBoneRotationsFromRest,
  captureRestPose,
  type RestPoseSnapshot,
} from './poseIk';

export interface RetargetReport {
  rotations: BoneRotationMap;
  positions: BoneRotationMap;
  mappedCount: number;
  unmappedRoles: CanonicalBoneRole[];
  notes: string[];
}

const TOPO_ROLES: CanonicalBoneRole[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftForeArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightForeArm',
  'rightHand',
  'leftUpLeg',
  'leftLeg',
  'leftFoot',
  'leftToe',
  'rightUpLeg',
  'rightLeg',
  'rightFoot',
  'rightToe',
];

const SEGMENT_CHILD_ROLE: Partial<Record<CanonicalBoneRole, CanonicalBoneRole>> = {
  leftShoulder: 'leftUpperArm',
  leftUpperArm: 'leftForeArm',
  leftForeArm: 'leftHand',
  rightShoulder: 'rightUpperArm',
  rightUpperArm: 'rightForeArm',
  rightForeArm: 'rightHand',
  leftUpLeg: 'leftLeg',
  leftLeg: 'leftFoot',
  rightUpLeg: 'rightLeg',
  rightLeg: 'rightFoot',
};

function getBoneSegmentDirection(
  bone: THREE.Bone,
  role: CanonicalBoneRole,
  roles: Partial<Record<CanonicalBoneRole, THREE.Bone>>
): THREE.Vector3 | null {
  const childRole = SEGMENT_CHILD_ROLE[role];
  if (!childRole) return null;
  let childBone = roles[childRole];
  if (!childBone && role !== 'leftShoulder' && role !== 'rightShoulder') {
    childBone = bone.children.find((c): c is THREE.Bone => (c as THREE.Bone).isBone);
  }
  if (!childBone) return null;

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  bone.getWorldPosition(p0);
  childBone.getWorldPosition(p1);
  const diff = p1.sub(p0);
  if (diff.lengthSq() < 1e-6) return null;
  return diff.normalize();
}

/**
 * Rest-frame-aware world-space retargeting from a driver/source rig to any target skinned rig.
 * Evaluates world-space bone deltas and rest-pose limb directions (e.g. T-pose vs A-pose,
 * Mixamo/VRM/Blender +Y local axes vs +X axes) and solves local Euler offsets relative to
 * each target bone's native bind frame in parent-to-child hierarchical order.
 */
export function retargetPoseAcrossRigs(
  sourceRoot: THREE.Object3D,
  sourceBoneRotations: BoneRotationMap,
  targetRoot: THREE.Object3D,
  targetRestPose?: RestPoseSnapshot,
  sourceRestPose?: RestPoseSnapshot,
  sourceBonePositions?: BoneRotationMap
): RetargetReport {
  const sourceBones = collectSkeletonBones(sourceRoot);
  const targetBones = collectSkeletonBones(targetRoot);
  const sourceRoles = mapBonesToRoles(sourceBones);
  const targetRoles = mapBonesToRoles(targetBones);

  const rotations: BoneRotationMap = {};
  const positions: BoneRotationMap = {};
  const unmappedRoles: CanonicalBoneRole[] = [];

  for (const role of TOPO_ROLES) {
    if (!targetRoles[role]) {
      unmappedRoles.push(role);
    }
  }

  const hasRotations = Object.keys(sourceBoneRotations).length > 0;
  const hasPositions = Boolean(sourceBonePositions && Object.keys(sourceBonePositions).length > 0);
  if (!hasRotations && !hasPositions) {
    return {
      rotations: {},
      positions: {},
      mappedCount: 0,
      unmappedRoles,
      notes: ['Reset target rig to rest pose.'],
    };
  }

  const prevSrcState = captureRestPose(sourceRoot);
  const prevTgtState = captureRestPose(targetRoot);
  const srcRest = sourceRestPose ?? prevSrcState;
  const tgtRest = targetRestPose ?? prevTgtState;

  let mappedCount = 0;

  try {
    // 1. Measure source rig in rest pose
    applyBoneRotationsFromRest(sourceRoot, srcRest, {});
    const srcWorldRestQuat = new Map<CanonicalBoneRole, THREE.Quaternion>();
    const srcRestDir = new Map<CanonicalBoneRole, THREE.Vector3>();
    for (const role of TOPO_ROLES) {
      const b = sourceRoles[role];
      if (!b) continue;
      srcWorldRestQuat.set(role, b.getWorldQuaternion(new THREE.Quaternion()));
      const dir = getBoneSegmentDirection(b, role, sourceRoles);
      if (dir) srcRestDir.set(role, dir);
    }

    // 2. Measure source rig in posed state -> compute world-space deltas per role
    applyBoneRotationsFromRest(sourceRoot, srcRest, sourceBoneRotations, undefined, sourceBonePositions);
    const srcWorldDelta = new Map<CanonicalBoneRole, THREE.Quaternion>();
    for (const role of TOPO_ROLES) {
      const b = sourceRoles[role];
      const restQ = srcWorldRestQuat.get(role);
      if (!b || !restQ) continue;
      const posedQ = b.getWorldQuaternion(new THREE.Quaternion());
      srcWorldDelta.set(role, posedQ.multiply(restQ.clone().invert()));
    }

    // 3. Measure target rig strictly in rest pose
    applyBoneRotationsFromRest(targetRoot, tgtRest, {});
    const tgtWorldRestQuat = new Map<CanonicalBoneRole, THREE.Quaternion>();
    const tgtRestDir = new Map<CanonicalBoneRole, THREE.Vector3>();
    for (const role of TOPO_ROLES) {
      const b = targetRoles[role];
      if (!b) continue;
      tgtWorldRestQuat.set(role, b.getWorldQuaternion(new THREE.Quaternion()));
      const dir = getBoneSegmentDirection(b, role, targetRoles);
      if (dir) tgtRestDir.set(role, dir);
    }

    // 4. Traverse target rig in parent-to-child order and solve local offsets
    const parentWorldQuat = new THREE.Quaternion();
    const srcParentWorldQuat = new THREE.Quaternion();
    const tgtParentWorldQuat = new THREE.Quaternion();
    const euler = new THREE.Euler(0, 0, 0, 'XYZ');

    for (const role of TOPO_ROLES) {
      const tgtBone = targetRoles[role];
      if (!tgtBone) continue;

      let effectiveSrcRole: CanonicalBoneRole = role;
      let srcBone = sourceRoles[role];
      // If target lacks a separate spine and only has chest, transfer driver spine onto chest
      if (
        role === 'chest' &&
        !targetRoles.spine &&
        sourceRoles.spine &&
        (sourceBoneRotations[sourceRoles.spine.name] || sourceBonePositions?.[sourceRoles.spine.name]) &&
        (!srcBone || (!sourceBoneRotations[srcBone.name] && !sourceBonePositions?.[srcBone.name]))
      ) {
        effectiveSrcRole = 'spine';
        srcBone = sourceRoles.spine;
      }

      if (!srcBone) continue;
      const hasSrcRot = Boolean(sourceBoneRotations[srcBone.name]);
      const srcPos = sourceBonePositions?.[srcBone.name];
      if (!hasSrcRot && !srcPos) continue;

      let boneMapped = false;

      if (srcPos) {
        const worldDelta = new THREE.Vector3(srcPos.x, srcPos.y, srcPos.z);
        if (srcBone.parent) {
          srcBone.parent.getWorldQuaternion(srcParentWorldQuat);
          worldDelta.applyQuaternion(srcParentWorldQuat);
        }
        if (tgtBone.parent) {
          tgtBone.parent.getWorldQuaternion(tgtParentWorldQuat);
          worldDelta.applyQuaternion(tgtParentWorldQuat.invert());
        }
        positions[tgtBone.name] = {
          x: worldDelta.x,
          y: worldDelta.y,
          z: worldDelta.z,
        };
        const restP = tgtRest.positions.get(tgtBone.name) ?? tgtBone.position.clone();
        tgtBone.position.set(restP.x + worldDelta.x, restP.y + worldDelta.y, restP.z + worldDelta.z);
        boneMapped = true;
      }

      if (hasSrcRot) {
        const srcDelta = srcWorldDelta.get(effectiveSrcRole);
        const tgtWorldRestQ = tgtWorldRestQuat.get(role);
        const tgtLocalRestQ = tgtRest.quaternions.get(tgtBone.name) ?? tgtBone.quaternion.clone();
        if (srcDelta && tgtWorldRestQ) {
          const sDir = srcRestDir.get(effectiveSrcRole);
          const tDir = tgtRestDir.get(role);
          const qRestAlign =
            sDir && tDir ? safeSetFromUnitVectors(sDir, tDir) : new THREE.Quaternion();

          const tgtWorldDesired = srcDelta
            .clone()
            .multiply(qRestAlign.invert())
            .multiply(tgtWorldRestQ);

          if (tgtBone.parent) {
            tgtBone.parent.getWorldQuaternion(parentWorldQuat);
          } else {
            parentWorldQuat.identity();
          }

          const localTargetQuat = parentWorldQuat.clone().invert().multiply(tgtWorldDesired);
          const deltaQuat = tgtLocalRestQ.clone().invert().multiply(localTargetQuat).normalize();

          euler.setFromQuaternion(deltaQuat, 'XYZ');
          rotations[tgtBone.name] = { x: euler.x, y: euler.y, z: euler.z };
          tgtBone.quaternion.copy(tgtLocalRestQ).multiply(deltaQuat);
          boneMapped = true;
        }
      }

      if (boneMapped) {
        mappedCount += 1;
        targetRoot.updateMatrixWorld(true);
      }
    }
  } finally {
    applyBoneRotationsFromRest(sourceRoot, prevSrcState, {});
    applyBoneRotationsFromRest(targetRoot, prevTgtState, {});
  }

  const notes: string[] = [];
  if (unmappedRoles.length > 0) {
    notes.push(
      `Unmapped target roles (${unmappedRoles.length}): ${unmappedRoles.slice(0, 6).join(', ')}${
        unmappedRoles.length > 6 ? '…' : ''
      }`
    );
  }

  return { rotations, positions, mappedCount, unmappedRoles, notes };
}

function angleFrom2D(dx: number, dy: number): number {
  return Math.atan2(dy, dx);
}

function findLandmark(landmarks: PoseLandmarkPoint[], idx: number): PoseLandmarkPoint | undefined {
  return landmarks.find((l) => l.index === idx);
}

/**
 * Solve approximate humanoid bone rotations from MediaPipe Pose 2D/3D landmarks.
 * One image supplies a single correctable pose (never an exact walking cycle or hidden-joint guarantee).
 */
export function solveReferenceSlotsToBoneRotations(
  targetRoot: THREE.Object3D,
  slots: ReferenceImageSlot[],
  primaryView: 'front' | 'side' | 'back'
): {
  rotations: BoneRotationMap;
  confidenceMean: number;
  missingJoints: string[];
  mappedJointsCount: number;
  notes: string[];
} {
  const primary = slots.find((s) => s.view === primaryView && s.landmarks.length > 0) ||
    slots.find((s) => s.landmarks.length > 0);

  if (!primary) {
    return {
      rotations: {},
      confidenceMean: 0,
      missingJoints: ['Full-body landmarks required'],
      mappedJointsCount: 0,
      notes: ['No detected or manual landmarks in the selected reference slot.'],
    };
  }

  const bones = collectSkeletonBones(targetRoot);
  const roles = mapBonesToRoles(bones);
  const lm = primary.landmarks;

  // Standard MediaPipe Pose 33-landmark indices:
  // 0: nose, 11: left_shoulder, 12: right_shoulder, 13: left_elbow, 14: right_elbow,
  // 15: left_wrist, 16: right_wrist, 23: left_hip, 24: right_hip,
  // 25: left_knee, 26: right_knee, 27: left_ankle, 28: right_ankle
  const lShoulder = findLandmark(lm, 11);
  const rShoulder = findLandmark(lm, 12);
  const lElbow = findLandmark(lm, 13);
  const rElbow = findLandmark(lm, 14);
  const lWrist = findLandmark(lm, 15);
  const rWrist = findLandmark(lm, 16);
  const lHip = findLandmark(lm, 23);
  const rHip = findLandmark(lm, 24);
  const lKnee = findLandmark(lm, 25);
  const rKnee = findLandmark(lm, 26);
  const lAnkle = findLandmark(lm, 27);
  const rAnkle = findLandmark(lm, 28);
  const nose = findLandmark(lm, 0);

  const rotations: BoneRotationMap = {};
  const missingJoints: string[] = [];
  let mappedJointsCount = 0;

  // Spine lean from shoulder midpoint -> hip midpoint
  if (lShoulder && rShoulder && lHip && rHip && roles.spine) {
    const shMidX = (lShoulder.x + rShoulder.x) * 0.5;
    const shMidY = (lShoulder.y + rShoulder.y) * 0.5;
    const hpMidX = (lHip.x + rHip.x) * 0.5;
    const hpMidY = (lHip.y + rHip.y) * 0.5;
    const leanZ = THREE.MathUtils.clamp((hpMidX - shMidX) * 1.4, -0.55, 0.55);
    const leanX = THREE.MathUtils.clamp((shMidY - hpMidY + 0.25) * 0.5, -0.35, 0.45);
    rotations[roles.spine.name] = { x: leanX, y: 0, z: leanZ };
    mappedJointsCount += 1;

    if (nose && roles.head) {
      const headTurn = THREE.MathUtils.clamp((nose.x - shMidX) * 2.2, -0.65, 0.65);
      rotations[roles.head.name] = { x: 0, y: headTurn, z: 0 };
      mappedJointsCount += 1;
    }
  } else {
    missingJoints.push('Torso/Hips');
  }

  // Left Upper Arm & Forearm (Note: image X axis mirrors viewer's right = subject's left)
  if (lShoulder && lElbow && roles.leftUpperArm) {
    const dx = lElbow.x - lShoulder.x;
    const dy = lElbow.y - lShoulder.y; // +y is downward in 2D image
    const angle = angleFrom2D(Math.abs(dx) + 0.05, dy);
    const zRot = THREE.MathUtils.clamp(-angle, -1.45, 1.35);
    rotations[roles.leftUpperArm.name] = { x: 0, y: THREE.MathUtils.clamp((lElbow.z - lShoulder.z) * 1.2, -0.8, 0.8), z: zRot };
    mappedJointsCount += 1;

    if (lWrist && roles.leftForeArm) {
      const fdx = lWrist.x - lElbow.x;
      const fdy = lWrist.y - lElbow.y;
      const bend = THREE.MathUtils.clamp(
        Math.abs(angleFrom2D(fdx, fdy) - angleFrom2D(dx, dy)),
        0,
        2.1
      );
      rotations[roles.leftForeArm.name] = { x: 0, y: -bend, z: 0 };
      mappedJointsCount += 1;
    }
  } else {
    missingJoints.push('Left Arm');
  }

  // Right Upper Arm & Forearm
  if (rShoulder && rElbow && roles.rightUpperArm) {
    const dx = rElbow.x - rShoulder.x;
    const dy = rElbow.y - rShoulder.y;
    const angle = angleFrom2D(Math.abs(dx) + 0.05, dy);
    const zRot = THREE.MathUtils.clamp(angle, -1.35, 1.45);
    rotations[roles.rightUpperArm.name] = { x: 0, y: THREE.MathUtils.clamp((rElbow.z - rShoulder.z) * -1.2, -0.8, 0.8), z: zRot };
    mappedJointsCount += 1;

    if (rWrist && roles.rightForeArm) {
      const fdx = rWrist.x - rElbow.x;
      const fdy = rWrist.y - rElbow.y;
      const bend = THREE.MathUtils.clamp(
        Math.abs(angleFrom2D(fdx, fdy) - angleFrom2D(dx, dy)),
        0,
        2.1
      );
      rotations[roles.rightForeArm.name] = { x: 0, y: bend, z: 0 };
      mappedJointsCount += 1;
    }
  } else {
    missingJoints.push('Right Arm');
  }

  // Left Leg
  if (lHip && lKnee && roles.leftUpLeg) {
    const dx = lKnee.x - lHip.x;
    const dy = Math.max(0.05, lKnee.y - lHip.y);
    const abduce = THREE.MathUtils.clamp(dx * 1.8, -0.7, 0.7);
    const lift = THREE.MathUtils.clamp((lHip.z - lKnee.z) * 1.4, -1.1, 0.9);
    rotations[roles.leftUpLeg.name] = { x: lift, y: 0, z: abduce };
    mappedJointsCount += 1;

    if (lAnkle && roles.leftLeg) {
      const kdx = lAnkle.x - lKnee.x;
      const kdy = Math.max(0.05, lAnkle.y - lKnee.y);
      const kneeBend = THREE.MathUtils.clamp(Math.abs(kdx - dx) * 1.8 + Math.max(0, dy - kdy) * 2.2, 0.05, 1.9);
      rotations[roles.leftLeg.name] = { x: kneeBend, y: 0, z: 0 };
      mappedJointsCount += 1;
    }
  } else {
    missingJoints.push('Left Leg');
  }

  // Right Leg
  if (rHip && rKnee && roles.rightUpLeg) {
    const dx = rKnee.x - rHip.x;
    const dy = Math.max(0.05, rKnee.y - rHip.y);
    const abduce = THREE.MathUtils.clamp(dx * 1.8, -0.7, 0.7);
    const lift = THREE.MathUtils.clamp((rHip.z - rKnee.z) * 1.4, -1.1, 0.9);
    rotations[roles.rightUpLeg.name] = { x: lift, y: 0, z: abduce };
    mappedJointsCount += 1;

    if (rAnkle && roles.rightLeg) {
      const kdx = rAnkle.x - rKnee.x;
      const kdy = Math.max(0.05, rAnkle.y - rKnee.y);
      const kneeBend = THREE.MathUtils.clamp(Math.abs(kdx - dx) * 1.8 + Math.max(0, dy - kdy) * 2.2, 0.05, 1.9);
      rotations[roles.rightLeg.name] = { x: kneeBend, y: 0, z: 0 };
      mappedJointsCount += 1;
    }
  } else {
    missingJoints.push('Right Leg');
  }

  // Optional side-view depth refinement ONLY if aligned & confirmed by the user
  const confirmedSide = slots.find((s) => s.view === 'side' && s.samePoseConfirmed && s.landmarks.length > 0);
  const notes: string[] = [];
  if (confirmedSide) {
    const slShoulder = findLandmark(confirmedSide.landmarks, 11);
    const slElbow = findLandmark(confirmedSide.landmarks, 13);
    if (slShoulder && slElbow && roles.leftUpperArm && rotations[roles.leftUpperArm.name]) {
      const fwdSwing = THREE.MathUtils.clamp((slElbow.x - slShoulder.x) * 2.2, -1.2, 1.2);
      rotations[roles.leftUpperArm.name].x = fwdSwing;
      notes.push('Side view depth refinement applied from confirmed same-pose slot.');
    }
  }

  if (missingJoints.length > 0) {
    notes.push(`Low visibility or missing joints: ${missingJoints.join(', ')}. Adjust landmarks manually if needed.`);
  }

  const visList = lm.map((p) => p.visibility).filter((v) => Number.isFinite(v));
  const confidenceMean =
    visList.length > 0 ? visList.reduce((acc, v) => acc + v, 0) / visList.length : 0;

  return {
    rotations,
    confidenceMean,
    missingJoints,
    mappedJointsCount,
    notes,
  };
}

export interface MultiViewMannequinResult {
  rotations: BoneRotationMap;
  usedViews: Array<'front' | 'side' | 'back'>;
  mappedBonesCount: number;
  confidenceMean: number;
  notes: string[];
}

function safeSetFromUnitVectors(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  const f = from.clone().normalize();
  const t = to.clone().normalize();
  const dot = f.dot(t);
  if (dot < -0.999) {
    const ortho = Math.abs(f.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const axis = new THREE.Vector3().crossVectors(f, ortho).normalize();
    return new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
  }
  return new THREE.Quaternion().setFromUnitVectors(f, t);
}

interface NormalizedViewFrame {
  view: 'front' | 'side' | 'back';
  hipMidX: number;
  hipMidY: number;
  scale: number;
  sideFacingSign: number; // +1 if facing +x in side image, -1 if facing -x
  pts: Map<number, PoseLandmarkPoint>;
}

function buildNormalizedViewFrame(slot: ReferenceImageSlot): NormalizedViewFrame | null {
  if (!slot.landmarks || slot.landmarks.length === 0) return null;
  const pts = new Map<number, PoseLandmarkPoint>();
  for (const p of slot.landmarks) {
    pts.set(p.index, p);
  }

  const lSh = pts.get(11);
  const rSh = pts.get(12);
  const lHp = pts.get(23);
  const rHp = pts.get(24);
  const nose = pts.get(0);

  const shMidX = lSh && rSh ? (lSh.x + rSh.x) * 0.5 : lSh?.x ?? rSh?.x ?? 0.5;
  const shMidY = lSh && rSh ? (lSh.y + rSh.y) * 0.5 : lSh?.y ?? rSh?.y ?? 0.3;
  const hpMidX = lHp && rHp ? (lHp.x + rHp.x) * 0.5 : lHp?.x ?? rHp?.x ?? shMidX;
  const hpMidY = lHp && rHp ? (lHp.y + rHp.y) * 0.5 : lHp?.y ?? rHp?.y ?? Math.min(0.85, shMidY + 0.28);

  const torsoHeight = Math.max(0.14, Math.abs(hpMidY - shMidY));
  // Detect side-view facing direction: nose vs shoulder midpoint
  let sideFacingSign = 1;
  if (nose) {
    const dx = nose.x - shMidX;
    if (Math.abs(dx) > 0.01) {
      sideFacingSign = dx > 0 ? 1 : -1;
    }
  }

  return {
    view: slot.view,
    hipMidX: hpMidX,
    hipMidY: hpMidY,
    scale: torsoHeight / 0.45, // normalize torso span to ~0.45 units
    sideFacingSign,
    pts,
  };
}

/**
 * Fuses Front, Side, and Rear (Back) Multi-View pose reference landmarks into
 * 3D joint positions and solves exact local BoneRotationMap rotations for the
 * built-in Pose Mannequin Driver.
 */
export function solveMultiViewPoseForMannequin(
  mannequinRoot: THREE.Object3D,
  slots: ReferenceImageSlot[]
): MultiViewMannequinResult {
  const frames: NormalizedViewFrame[] = [];
  for (const view of ['front', 'side', 'back'] as const) {
    const slot = slots.find((s) => s.view === view);
    if (slot) {
      const f = buildNormalizedViewFrame(slot);
      if (f) frames.push(f);
    }
  }

  if (frames.length === 0) {
    return {
      rotations: {},
      usedViews: [],
      mappedBonesCount: 0,
      confidenceMean: 0,
      notes: ['No detected or manual landmarks in Front, Side, or Rear reference slots.'],
    };
  }

  const bones = collectSkeletonBones(mannequinRoot);
  const roles = mapBonesToRoles(bones);

  const jointIndices = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const fused3D = new Map<number, THREE.Vector3>();
  let visSum = 0;
  let visCount = 0;

  for (const idx of jointIndices) {
    let sumX = 0;
    let wX = 0;
    let sumY = 0;
    let wY = 0;
    let sumZ = 0;
    let wZ = 0;

    for (const f of frames) {
      const p = f.pts.get(idx);
      if (!p) continue;
      const vis = Number.isFinite(p.visibility) ? Math.max(0.15, p.visibility) : 0.7;
      visSum += vis;
      visCount += 1;

      const ny = -(p.y - f.hipMidY) / f.scale;
      sumY += ny * vis;
      wY += vis;

      if (f.view === 'front') {
        const nx = (p.x - f.hipMidX) / f.scale;
        sumX += nx * vis * 1.25;
        wX += vis * 1.25;
        // Scale MediaPipe 3D z consistently with torso scale when side view isn't present
        const nz = -(p.z || 0) / f.scale;
        sumZ += nz * vis * 0.85;
        wZ += vis * 0.85;
      } else if (f.view === 'back') {
        // Rear view mirrors horizontal viewer axis relative to front
        const nx = -(p.x - f.hipMidX) / f.scale;
        sumX += nx * vis * 1.1;
        wX += vis * 1.1;
        const nz = (p.z || 0) / f.scale;
        sumZ += nz * vis * 0.85;
        wZ += vis * 0.85;
      } else if (f.view === 'side') {
        // Side view provides high-weight Z depth (forward/backward limb & spine reach)
        const nz = ((p.x - f.hipMidX) / f.scale) * f.sideFacingSign;
        sumZ += nz * vis * 2.2;
        wZ += vis * 2.2;
      }
    }

    if (wY > 0) {
      fused3D.set(
        idx,
        new THREE.Vector3(wX > 0 ? sumX / wX : 0, sumY / wY, wZ > 0 ? sumZ / wZ : 0)
      );
    }
  }

  const rotations: BoneRotationMap = {};
  let mappedBonesCount = 0;
  const euler = new THREE.Euler(0, 0, 0, 'XYZ');

  const pNose = fused3D.get(0);
  const pLSh = fused3D.get(11);
  const pRSh = fused3D.get(12);
  const pLEl = fused3D.get(13);
  const pREl = fused3D.get(14);
  const pLWr = fused3D.get(15);
  const pRWr = fused3D.get(16);
  const pLHp = fused3D.get(23);
  const pRHp = fused3D.get(24);
  const pLKn = fused3D.get(25);
  const pRKn = fused3D.get(26);
  const pLAn = fused3D.get(27);
  const pRAn = fused3D.get(28);

  // 0. Optional subtle Hips yaw/roll from pelvis alignment
  let hipsQuat = new THREE.Quaternion();
  if (pLHp && pRHp && roles.hips) {
    const hipVec = pLHp.clone().sub(pRHp);
    if (hipVec.lengthSq() > 1e-4) {
      const hipYaw = THREE.MathUtils.clamp(Math.atan2(-hipVec.z, Math.max(0.05, hipVec.x)) * 0.5, -0.55, 0.55);
      const hipRoll = THREE.MathUtils.clamp(Math.atan2(hipVec.y, Math.max(0.05, hipVec.x)) * 0.45, -0.25, 0.25);
      if (Math.abs(hipYaw) > 0.03 || Math.abs(hipRoll) > 0.03) {
        hipsQuat.setFromEuler(new THREE.Euler(0, hipYaw, hipRoll, 'XYZ'));
        rotations[roles.hips.name] = { x: 0, y: hipYaw, z: hipRoll };
        mappedBonesCount += 1;
      }
    }
  }
  const hipsInv = hipsQuat.clone().invert();

  // 1. Spine / Torso orientation (+Y rest vector) + shoulder twist relative to hips
  let torsoWorldQuat = hipsQuat.clone();
  if (pLSh && pRSh && pLHp && pRHp && roles.spine) {
    const shMid = pLSh.clone().add(pRSh).multiplyScalar(0.5);
    const hpMid = pLHp.clone().add(pRHp).multiplyScalar(0.5);
    const torsoDirLocal = shMid.clone().sub(hpMid).applyQuaternion(hipsInv);
    if (torsoDirLocal.lengthSq() > 1e-4) {
      const qSwing = safeSetFromUnitVectors(new THREE.Vector3(0, 1, 0), torsoDirLocal);
      const shVec = pLSh.clone().sub(pRSh).applyQuaternion(hipsInv);
      const yaw = THREE.MathUtils.clamp(Math.atan2(-shVec.z, Math.max(0.05, shVec.x)) * 0.55, -0.65, 0.65);
      const qTwist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const spineLocalQuat = qSwing.multiply(qTwist);
      euler.setFromQuaternion(spineLocalQuat, 'XYZ');
      rotations[roles.spine.name] = {
        x: THREE.MathUtils.clamp(euler.x, -0.75, 0.75),
        y: THREE.MathUtils.clamp(euler.y, -0.75, 0.75),
        z: THREE.MathUtils.clamp(euler.z, -0.65, 0.65),
      };
      const clampedSpineQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          rotations[roles.spine.name].x,
          rotations[roles.spine.name].y,
          rotations[roles.spine.name].z,
          'XYZ'
        )
      );
      torsoWorldQuat = hipsQuat.clone().multiply(clampedSpineQ);
      mappedBonesCount += 1;

      if (pNose && roles.head) {
        const headVec = pNose.clone().sub(shMid).applyQuaternion(torsoWorldQuat.clone().invert());
        if (headVec.lengthSq() > 1e-4) {
          const qHead = safeSetFromUnitVectors(new THREE.Vector3(0, 1, 0.25).normalize(), headVec);
          euler.setFromQuaternion(qHead, 'XYZ');
          rotations[roles.head.name] = {
            x: THREE.MathUtils.clamp(euler.x, -0.65, 0.65),
            y: THREE.MathUtils.clamp(euler.y, -0.8, 0.8),
            z: THREE.MathUtils.clamp(euler.z, -0.45, 0.45),
          };
          mappedBonesCount += 1;
        }
      }
    }
  }

  const torsoInv = torsoWorldQuat.clone().invert();

  // 2. Left Arm (rest direction +X = (1, 0, 0))
  if (pLSh && pLEl && roles.leftUpperArm) {
    const upperDirLocal = pLEl.clone().sub(pLSh).applyQuaternion(torsoInv);
    if (upperDirLocal.lengthSq() > 1e-4) {
      const qUpper = safeSetFromUnitVectors(new THREE.Vector3(1, 0, 0), upperDirLocal);
      euler.setFromQuaternion(qUpper, 'XYZ');
      rotations[roles.leftUpperArm.name] = { x: euler.x, y: euler.y, z: euler.z };
      mappedBonesCount += 1;

      if (pLWr && roles.leftForeArm) {
        const foreDirInUpper = pLWr
          .clone()
          .sub(pLEl)
          .applyQuaternion(torsoInv)
          .applyQuaternion(qUpper.clone().invert());
        if (foreDirInUpper.lengthSq() > 1e-4) {
          const qFore = safeSetFromUnitVectors(new THREE.Vector3(1, 0, 0), foreDirInUpper);
          euler.setFromQuaternion(qFore, 'XYZ');
          rotations[roles.leftForeArm.name] = { x: euler.x, y: euler.y, z: euler.z };
          mappedBonesCount += 1;
        }
      }
    }
  }

  // 3. Right Arm (rest direction -X = (-1, 0, 0))
  if (pRSh && pREl && roles.rightUpperArm) {
    const upperDirLocal = pREl.clone().sub(pRSh).applyQuaternion(torsoInv);
    if (upperDirLocal.lengthSq() > 1e-4) {
      const qUpper = safeSetFromUnitVectors(new THREE.Vector3(-1, 0, 0), upperDirLocal);
      euler.setFromQuaternion(qUpper, 'XYZ');
      rotations[roles.rightUpperArm.name] = { x: euler.x, y: euler.y, z: euler.z };
      mappedBonesCount += 1;

      if (pRWr && roles.rightForeArm) {
        const foreDirInUpper = pRWr
          .clone()
          .sub(pREl)
          .applyQuaternion(torsoInv)
          .applyQuaternion(qUpper.clone().invert());
        if (foreDirInUpper.lengthSq() > 1e-4) {
          const qFore = safeSetFromUnitVectors(new THREE.Vector3(-1, 0, 0), foreDirInUpper);
          euler.setFromQuaternion(qFore, 'XYZ');
          rotations[roles.rightForeArm.name] = { x: euler.x, y: euler.y, z: euler.z };
          mappedBonesCount += 1;
        }
      }
    }
  }

  // 4. Left Leg (rest direction -Y = (0, -1, 0), child of Hips)
  if (pLHp && pLKn && roles.leftUpLeg) {
    const thighDir = pLKn.clone().sub(pLHp).applyQuaternion(hipsInv);
    if (thighDir.lengthSq() > 1e-4) {
      const qThigh = safeSetFromUnitVectors(new THREE.Vector3(0, -1, 0), thighDir);
      euler.setFromQuaternion(qThigh, 'XYZ');
      rotations[roles.leftUpLeg.name] = { x: euler.x, y: euler.y, z: euler.z };
      mappedBonesCount += 1;

      if (pLAn && roles.leftLeg) {
        const shinDirLocal = pLAn
          .clone()
          .sub(pLKn)
          .applyQuaternion(hipsInv)
          .applyQuaternion(qThigh.clone().invert());
        if (shinDirLocal.lengthSq() > 1e-4) {
          const qShin = safeSetFromUnitVectors(new THREE.Vector3(0, -1, 0), shinDirLocal);
          euler.setFromQuaternion(qShin, 'XYZ');
          rotations[roles.leftLeg.name] = { x: euler.x, y: euler.y, z: euler.z };
          mappedBonesCount += 1;
        }
      }
    }
  }

  // 5. Right Leg (rest direction -Y = (0, -1, 0), child of Hips)
  if (pRHp && pRKn && roles.rightUpLeg) {
    const thighDir = pRKn.clone().sub(pRHp).applyQuaternion(hipsInv);
    if (thighDir.lengthSq() > 1e-4) {
      const qThigh = safeSetFromUnitVectors(new THREE.Vector3(0, -1, 0), thighDir);
      euler.setFromQuaternion(qThigh, 'XYZ');
      rotations[roles.rightUpLeg.name] = { x: euler.x, y: euler.y, z: euler.z };
      mappedBonesCount += 1;

      if (pRAn && roles.rightLeg) {
        const shinDirLocal = pRAn
          .clone()
          .sub(pRKn)
          .applyQuaternion(hipsInv)
          .applyQuaternion(qThigh.clone().invert());
        if (shinDirLocal.lengthSq() > 1e-4) {
          const qShin = safeSetFromUnitVectors(new THREE.Vector3(0, -1, 0), shinDirLocal);
          euler.setFromQuaternion(qShin, 'XYZ');
          rotations[roles.rightLeg.name] = { x: euler.x, y: euler.y, z: euler.z };
          mappedBonesCount += 1;
        }
      }
    }
  }

  const usedViews = frames.map((f) => f.view);
  const viewNames = usedViews.map((v) => (v === 'back' ? 'Rear' : v[0].toUpperCase() + v.slice(1)));
  const notes = [
    `Fused ${viewNames.join(' + ')} reference landmarks into ${mappedBonesCount} mannequin driver bone(s).`,
  ];

  return {
    rotations,
    usedViews,
    mappedBonesCount,
    confidenceMean: visCount > 0 ? visSum / visCount : 0,
    notes,
  };
}

