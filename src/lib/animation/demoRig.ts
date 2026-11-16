import * as THREE from 'three';

export interface DemoRigBundle {
  root: THREE.Group;
  skeleton: THREE.Skeleton;
  skinnedMesh: THREE.SkinnedMesh;
  clips: THREE.AnimationClip[];
}

interface SegmentSpec {
  boneIndex: number;
  parentIndex: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  radiusTop: number;
  radiusBottom: number;
  radialSegs: number;
  heightSegs: number;
  colorHex: number;
}

function buildSegmentedSkinnedGeometry(segments: SegmentSpec[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  let vertexOffset = 0;
  const up = new THREE.Vector3(0, 1, 0);

  for (const seg of segments) {
    const dir = new THREE.Vector3().subVectors(seg.end, seg.start);
    const len = Math.max(dir.length(), 0.01);
    const mid = new THREE.Vector3().addVectors(seg.start, seg.end).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());

    const cyl = new THREE.CylinderGeometry(
      seg.radiusTop,
      seg.radiusBottom,
      len,
      seg.radialSegs,
      seg.heightSegs,
      false
    );
    cyl.applyQuaternion(quat);
    cyl.translate(mid.x, mid.y, mid.z);

    const posAttr = cyl.getAttribute('position');
    const normAttr = cyl.getAttribute('normal');
    const uvAttr = cyl.getAttribute('uv');
    const col = new THREE.Color(seg.colorHex);

    const startPlane = dir.clone().normalize();

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      positions.push(vx, vy, vz);
      normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
      uvs.push(uvAttr.getX(i), uvAttr.getY(i));
      colors.push(col.r, col.g, col.b);

      // Compute smooth skin blend near parent joint for genuine deformation across joints
      const rel = new THREE.Vector3(vx, vy, vz).sub(seg.start);
      const t = THREE.MathUtils.clamp(rel.dot(startPlane) / len, 0, 1);

      if (seg.parentIndex >= 0 && t < 0.25) {
        const wPrimary = 0.5 + (t / 0.25) * 0.5;
        const wParent = 1 - wPrimary;
        skinIndices.push(seg.boneIndex, seg.parentIndex, 0, 0);
        skinWeights.push(wPrimary, wParent, 0, 0);
      } else {
        skinIndices.push(seg.boneIndex, 0, 0, 0);
        skinWeights.push(1, 0, 0, 0);
      }
    }

    const idx = cyl.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + vertexOffset);
      }
    }

    vertexOffset += posAttr.count;
    cyl.dispose();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geo.setIndex(indices);
  return geo;
}

export function createDemoSkinnedCharacter(
  variant: 'demo' | 'mannequin' = 'demo'
): DemoRigBundle {
  const root = new THREE.Group();
  root.name = variant === 'mannequin' ? 'RAPUSO_Mannequin_Driver' : 'RAPUSO_Demo_Humanoid';

  const bones: THREE.Bone[] = [];
  const boneIndexMap = new Map<string, number>();
  const worldPosMap = new Map<string, THREE.Vector3>();

  function addBone(
    name: string,
    parentName: string | null,
    worldPos: [number, number, number]
  ): number {
    const bone = new THREE.Bone();
    bone.name = name;
    const wp = new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2]);
    if (parentName && boneIndexMap.has(parentName)) {
      const pIdx = boneIndexMap.get(parentName)!;
      const pWorld = worldPosMap.get(parentName)!;
      bone.position.copy(wp).sub(pWorld);
      bones[pIdx].add(bone);
    } else {
      bone.position.copy(wp);
      root.add(bone);
    }
    const idx = bones.length;
    bones.push(bone);
    boneIndexMap.set(name, idx);
    worldPosMap.set(name, wp);
    return idx;
  }

  // Core torso & head
  addBone('Hips', null, [0, 0.94, 0]);
  addBone('Spine', 'Hips', [0, 1.09, 0]);
  addBone('Chest', 'Spine', [0, 1.28, 0]);
  addBone('Neck', 'Chest', [0, 1.44, 0]);
  addBone('Head', 'Neck', [0, 1.54, 0]);

  // Left arm & articulated fingers
  addBone('LeftShoulder', 'Chest', [0.08, 1.38, 0]);
  addBone('LeftUpperArm', 'LeftShoulder', [0.19, 1.37, 0]);
  addBone('LeftForeArm', 'LeftUpperArm', [0.43, 1.37, 0]);
  addBone('LeftHand', 'LeftForeArm', [0.66, 1.37, 0]);

  // Right arm & articulated fingers
  addBone('RightShoulder', 'Chest', [-0.08, 1.38, 0]);
  addBone('RightUpperArm', 'RightShoulder', [-0.19, 1.37, 0]);
  addBone('RightForeArm', 'RightUpperArm', [-0.43, 1.37, 0]);
  addBone('RightHand', 'RightForeArm', [-0.66, 1.37, 0]);

  // Articulated finger chains (Thumb, Index, Middle, Ring, Little) — 2 joints per finger for clear deformation
  const fingerDefs: Array<{ name: string; zOff: number; len1: number; len2: number }> = [
    { name: 'Thumb', zOff: 0.036, len1: 0.035, len2: 0.03 },
    { name: 'Index', zOff: 0.024, len1: 0.045, len2: 0.035 },
    { name: 'Middle', zOff: 0.006, len1: 0.05, len2: 0.038 },
    { name: 'Ring', zOff: -0.012, len1: 0.046, len2: 0.034 },
    { name: 'Little', zOff: -0.028, len1: 0.038, len2: 0.028 },
  ];

  for (const side of ['Left', 'Right'] as const) {
    const dir = side === 'Left' ? 1 : -1;
    const handWorld = worldPosMap.get(`${side}Hand`)!;
    for (const f of fingerDefs) {
      const b1Name = `${side}Hand${f.name}1`;
      const b2Name = `${side}Hand${f.name}2`;
      const x1 = handWorld.x + dir * (f.name === 'Thumb' ? 0.035 : 0.068);
      const z1 = handWorld.z + f.zOff;
      addBone(b1Name, `${side}Hand`, [x1, handWorld.y - (f.name === 'Thumb' ? 0.015 : 0), z1]);
      addBone(b2Name, b1Name, [x1 + dir * f.len1, handWorld.y - (f.name === 'Thumb' ? 0.02 : 0), z1]);
    }
  }

  // Legs
  addBone('LeftUpLeg', 'Hips', [0.1, 0.9, 0]);
  addBone('LeftLeg', 'LeftUpLeg', [0.1, 0.49, 0]);
  addBone('LeftFoot', 'LeftLeg', [0.1, 0.08, 0]);
  addBone('LeftToeBase', 'LeftFoot', [0.1, 0.02, 0.11]);

  addBone('RightUpLeg', 'Hips', [-0.1, 0.9, 0]);
  addBone('RightLeg', 'RightUpLeg', [-0.1, 0.49, 0]);
  addBone('RightFoot', 'RightLeg', [-0.1, 0.08, 0]);
  addBone('RightToeBase', 'RightFoot', [-0.1, 0.02, 0.11]);

  const idxOf = (name: string) => boneIndexMap.get(name)!;
  const posOf = (name: string) => worldPosMap.get(name)!;

  const isMannequin = variant === 'mannequin';
  const torsoCol = isMannequin ? 0xd9dce6 : 0x2b3248;
  const accentCol = isMannequin ? 0xe6a1b0 : 0xe6a1b0;
  const skinCol = isMannequin ? 0xe8ebf2 : 0xf4dcd6;
  const limbCol = isMannequin ? 0xbec5d4 : 0x3b435e;
  const bootCol = isMannequin ? 0x626b80 : 0x1d2130;

  const segments: SegmentSpec[] = [
    // Pelvis / Spine / Chest / Neck / Head
    {
      boneIndex: idxOf('Hips'),
      parentIndex: -1,
      start: posOf('Hips').clone().add(new THREE.Vector3(0, -0.06, 0)),
      end: posOf('Spine'),
      radiusTop: 0.125,
      radiusBottom: 0.135,
      radialSegs: 14,
      heightSegs: 4,
      colorHex: torsoCol,
    },
    {
      boneIndex: idxOf('Spine'),
      parentIndex: idxOf('Hips'),
      start: posOf('Spine'),
      end: posOf('Chest'),
      radiusTop: 0.135,
      radiusBottom: 0.115,
      radialSegs: 14,
      heightSegs: 4,
      colorHex: torsoCol,
    },
    {
      boneIndex: idxOf('Chest'),
      parentIndex: idxOf('Spine'),
      start: posOf('Chest'),
      end: posOf('Neck'),
      radiusTop: 0.105,
      radiusBottom: 0.145,
      radialSegs: 14,
      heightSegs: 4,
      colorHex: accentCol,
    },
    {
      boneIndex: idxOf('Neck'),
      parentIndex: idxOf('Chest'),
      start: posOf('Neck'),
      end: posOf('Head'),
      radiusTop: 0.045,
      radiusBottom: 0.052,
      radialSegs: 10,
      heightSegs: 2,
      colorHex: skinCol,
    },
    {
      boneIndex: idxOf('Head'),
      parentIndex: idxOf('Neck'),
      start: posOf('Head'),
      end: posOf('Head').clone().add(new THREE.Vector3(0, 0.21, 0)),
      radiusTop: 0.095,
      radiusBottom: 0.088,
      radialSegs: 16,
      heightSegs: 4,
      colorHex: skinCol,
    },
    // Arms
    ...(['Left', 'Right'] as const).flatMap((side) => [
      {
        boneIndex: idxOf(`${side}Shoulder`),
        parentIndex: idxOf('Chest'),
        start: posOf(`${side}Shoulder`),
        end: posOf(`${side}UpperArm`),
        radiusTop: 0.055,
        radiusBottom: 0.062,
        radialSegs: 10,
        heightSegs: 2,
        colorHex: accentCol,
      },
      {
        boneIndex: idxOf(`${side}UpperArm`),
        parentIndex: idxOf(`${side}Shoulder`),
        start: posOf(`${side}UpperArm`),
        end: posOf(`${side}ForeArm`),
        radiusTop: 0.044,
        radiusBottom: 0.054,
        radialSegs: 12,
        heightSegs: 5,
        colorHex: limbCol,
      },
      {
        boneIndex: idxOf(`${side}ForeArm`),
        parentIndex: idxOf(`${side}UpperArm`),
        start: posOf(`${side}ForeArm`),
        end: posOf(`${side}Hand`),
        radiusTop: 0.035,
        radiusBottom: 0.044,
        radialSegs: 12,
        heightSegs: 5,
        colorHex: skinCol,
      },
      {
        boneIndex: idxOf(`${side}Hand`),
        parentIndex: idxOf(`${side}ForeArm`),
        start: posOf(`${side}Hand`),
        end: posOf(`${side}Hand`).clone().add(new THREE.Vector3(side === 'Left' ? 0.072 : -0.072, 0, 0)),
        radiusTop: 0.032,
        radiusBottom: 0.036,
        radialSegs: 10,
        heightSegs: 2,
        colorHex: skinCol,
      },
      // Fingers
      ...fingerDefs.flatMap((f) => {
        const dir = side === 'Left' ? 1 : -1;
        const b1 = `${side}Hand${f.name}1`;
        const b2 = `${side}Hand${f.name}2`;
        return [
          {
            boneIndex: idxOf(b1),
            parentIndex: idxOf(`${side}Hand`),
            start: posOf(b1),
            end: posOf(b2),
            radiusTop: 0.008,
            radiusBottom: 0.01,
            radialSegs: 6,
            heightSegs: 2,
            colorHex: skinCol,
          },
          {
            boneIndex: idxOf(b2),
            parentIndex: idxOf(b1),
            start: posOf(b2),
            end: posOf(b2).clone().add(new THREE.Vector3(dir * f.len2, 0, 0)),
            radiusTop: 0.006,
            radiusBottom: 0.008,
            radialSegs: 6,
            heightSegs: 2,
            colorHex: accentCol,
          },
        ];
      }),
    ]),
    // Legs
    ...(['Left', 'Right'] as const).flatMap((side) => [
      {
        boneIndex: idxOf(`${side}UpLeg`),
        parentIndex: idxOf('Hips'),
        start: posOf(`${side}UpLeg`),
        end: posOf(`${side}Leg`),
        radiusTop: 0.062,
        radiusBottom: 0.08,
        radialSegs: 12,
        heightSegs: 5,
        colorHex: limbCol,
      },
      {
        boneIndex: idxOf(`${side}Leg`),
        parentIndex: idxOf(`${side}UpLeg`),
        start: posOf(`${side}Leg`),
        end: posOf(`${side}Foot`),
        radiusTop: 0.044,
        radiusBottom: 0.058,
        radialSegs: 12,
        heightSegs: 5,
        colorHex: limbCol,
      },
      {
        boneIndex: idxOf(`${side}Foot`),
        parentIndex: idxOf(`${side}Leg`),
        start: posOf(`${side}Foot`),
        end: posOf(`${side}ToeBase`),
        radiusTop: 0.042,
        radiusBottom: 0.048,
        radialSegs: 10,
        heightSegs: 2,
        colorHex: bootCol,
      },
      {
        boneIndex: idxOf(`${side}ToeBase`),
        parentIndex: idxOf(`${side}Foot`),
        start: posOf(`${side}ToeBase`),
        end: posOf(`${side}ToeBase`).clone().add(new THREE.Vector3(0, 0, 0.06)),
        radiusTop: 0.032,
        radiusBottom: 0.04,
        radialSegs: 8,
        heightSegs: 2,
        colorHex: bootCol,
      },
    ]),
  ];

  const geometry = buildSegmentedSkinnedGeometry(segments);
  const material = new THREE.MeshStandardMaterial({
    name: variant === 'mannequin' ? 'Mannequin_Clay' : 'Demo_Anime_Suit',
    vertexColors: true,
    roughness: isMannequin ? 0.65 : 0.48,
    metalness: isMannequin ? 0.05 : 0.1,
  });

  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.name = variant === 'mannequin' ? 'Mannequin_Body' : 'Demo_Body';
  skinnedMesh.castShadow = true;
  skinnedMesh.receiveShadow = true;
  root.add(skinnedMesh);

  const skeleton = new THREE.Skeleton(bones);
  root.updateMatrixWorld(true);
  skinnedMesh.bind(skeleton);

  // Relax arms slightly downward from T-pose so natural inspection looks poised (preserving rest bind pose in skeleton.boneInverses)
  const clips = variant === 'demo' ? buildDemoAnimationClips() : [];

  return {
    root,
    skeleton,
    skinnedMesh,
    clips,
  };
}

function quatKeyTrack(
  boneName: string,
  times: number[],
  eulersXYZ: Array<[number, number, number]>
): THREE.QuaternionKeyframeTrack {
  const values: number[] = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const [x, y, z] of eulersXYZ) {
    e.set(x, y, z, 'XYZ');
    q.setFromEuler(e);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values);
}

export function buildDemoAnimationClips(): THREE.AnimationClip[] {
  const idle = new THREE.AnimationClip('Idle Breath', 3.0, [
    quatKeyTrack('Spine', [0, 1.5, 3], [
      [0.02, 0, 0],
      [-0.04, 0, 0],
      [0.02, 0, 0],
    ]),
    quatKeyTrack('LeftUpperArm', [0, 1.5, 3], [
      [0, 0, -1.15],
      [0.04, 0, -1.1],
      [0, 0, -1.15],
    ]),
    quatKeyTrack('RightUpperArm', [0, 1.5, 3], [
      [0, 0, 1.15],
      [0.04, 0, 1.1],
      [0, 0, 1.15],
    ]),
    quatKeyTrack('LeftForeArm', [0, 1.5, 3], [
      [0, -0.25, 0],
      [0, -0.35, 0],
      [0, -0.25, 0],
    ]),
    quatKeyTrack('RightForeArm', [0, 1.5, 3], [
      [0, 0.25, 0],
      [0, 0.35, 0],
      [0, 0.25, 0],
    ]),
  ]);

  const walk = new THREE.AnimationClip('Studio Walk', 2.0, [
    quatKeyTrack('Hips', [0, 0.5, 1.0, 1.5, 2.0], [
      [0, 0.08, 0],
      [0, 0, 0.03],
      [0, -0.08, 0],
      [0, 0, -0.03],
      [0, 0.08, 0],
    ]),
    quatKeyTrack('LeftUpLeg', [0, 0.5, 1.0, 1.5, 2.0], [
      [-0.45, 0, 0],
      [0, 0, 0],
      [0.4, 0, 0],
      [0, 0, 0],
      [-0.45, 0, 0],
    ]),
    quatKeyTrack('LeftLeg', [0, 0.5, 1.0, 1.5, 2.0], [
      [0.15, 0, 0],
      [0.08, 0, 0],
      [0.6, 0, 0],
      [0.75, 0, 0],
      [0.15, 0, 0],
    ]),
    quatKeyTrack('RightUpLeg', [0, 0.5, 1.0, 1.5, 2.0], [
      [0.4, 0, 0],
      [0, 0, 0],
      [-0.45, 0, 0],
      [0, 0, 0],
      [0.4, 0, 0],
    ]),
    quatKeyTrack('RightLeg', [0, 0.5, 1.0, 1.5, 2.0], [
      [0.6, 0, 0],
      [0.75, 0, 0],
      [0.15, 0, 0],
      [0.08, 0, 0],
      [0.6, 0, 0],
    ]),
    quatKeyTrack('LeftUpperArm', [0, 0.5, 1.0, 1.5, 2.0], [
      [0.35, 0, -1.15],
      [0, 0, -1.15],
      [-0.35, 0, -1.15],
      [0, 0, -1.15],
      [0.35, 0, -1.15],
    ]),
    quatKeyTrack('RightUpperArm', [0, 0.5, 1.0, 1.5, 2.0], [
      [-0.35, 0, 1.15],
      [0, 0, 1.15],
      [0.35, 0, 1.15],
      [0, 0, 1.15],
      [-0.35, 0, 1.15],
    ]),
    quatKeyTrack('LeftForeArm', [0, 1.0, 2.0], [
      [0, -0.35, 0],
      [0, -0.55, 0],
      [0, -0.35, 0],
    ]),
    quatKeyTrack('RightForeArm', [0, 1.0, 2.0], [
      [0, 0.55, 0],
      [0, 0.35, 0],
      [0, 0.55, 0],
    ]),
  ]);

  const wave = new THREE.AnimationClip('Wave & Turn', 3.0, [
    quatKeyTrack('Spine', [0, 1.5, 3.0], [
      [0, 0.15, 0],
      [0, -0.15, 0],
      [0, 0.15, 0],
    ]),
    quatKeyTrack('RightUpperArm', [0, 0.8, 1.5, 2.2, 3.0], [
      [0, 0, 1.1],
      [-0.3, 0, -0.35],
      [-0.3, 0, -0.55],
      [-0.3, 0, -0.35],
      [0, 0, 1.1],
    ]),
    quatKeyTrack('RightForeArm', [0, 0.8, 1.3, 1.8, 2.3, 3.0], [
      [0, 0.2, 0],
      [0, 1.15, 0],
      [0, 0.7, 0],
      [0, 1.25, 0],
      [0, 0.75, 0],
      [0, 0.2, 0],
    ]),
    quatKeyTrack('LeftUpperArm', [0, 1.5, 3.0], [
      [0, 0, -1.2],
      [0.1, 0, -1.1],
      [0, 0, -1.2],
    ]),
  ]);

  const heroStance = new THREE.AnimationClip('Hero Action Stance', 2.4, [
    quatKeyTrack('Hips', [0, 1.2, 2.4], [
      [0.05, 0.35, 0],
      [0.08, 0.42, 0],
      [0.05, 0.35, 0],
    ]),
    quatKeyTrack('Spine', [0, 1.2, 2.4], [
      [0.12, -0.25, 0],
      [0.16, -0.28, 0],
      [0.12, -0.25, 0],
    ]),
    quatKeyTrack('LeftUpLeg', [0, 2.4], [
      [-0.35, 0, 0.18],
      [-0.35, 0, 0.18],
    ]),
    quatKeyTrack('LeftLeg', [0, 2.4], [
      [0.55, 0, 0],
      [0.55, 0, 0],
    ]),
    quatKeyTrack('RightUpLeg', [0, 2.4], [
      [0.28, 0, -0.18],
      [0.28, 0, -0.18],
    ]),
    quatKeyTrack('RightLeg', [0, 2.4], [
      [0.22, 0, 0],
      [0.22, 0, 0],
    ]),
    quatKeyTrack('LeftUpperArm', [0, 1.2, 2.4], [
      [-0.4, 0, -0.75],
      [-0.45, 0, -0.85],
      [-0.4, 0, -0.75],
    ]),
    quatKeyTrack('LeftForeArm', [0, 2.4], [
      [0, -1.1, 0],
      [0, -1.1, 0],
    ]),
    quatKeyTrack('RightUpperArm', [0, 1.2, 2.4], [
      [0.35, 0, 0.85],
      [0.42, 0, 0.92],
      [0.35, 0, 0.85],
    ]),
    quatKeyTrack('RightForeArm', [0, 2.4], [
      [0, 0.9, 0],
      [0, 0.9, 0],
    ]),
  ]);

  return [idle, walk, wave, heroStance];
}

export function createBuiltinPropMesh(kind: 'blade' | 'mic' | 'block'): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'blade') {
    g.name = 'Prop_Katana_Ref';
    const hilt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0x1b1e2b, roughness: 0.7 })
    );
    const guard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.012, 14),
      new THREE.MeshStandardMaterial({ color: 0xe6a1b0, metalness: 0.6, roughness: 0.3 })
    );
    guard.position.y = 0.11;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.72, 0.028),
      new THREE.MeshStandardMaterial({ color: 0xdbe2f0, metalness: 0.85, roughness: 0.2 })
    );
    blade.position.y = 0.47;
    g.add(hilt, guard, blade);
  } else if (kind === 'mic') {
    g.name = 'Prop_Studio_Mic';
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.32, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3d, metalness: 0.5, roughness: 0.4 })
    );
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x5eead4, metalness: 0.4, roughness: 0.35 })
    );
    head.position.y = 0.18;
    g.add(rod, head);
  } else {
    g.name = 'Prop_Ref_Cube';
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xe6a1b0, roughness: 0.5 })
    );
    g.add(box);
  }
  return g;
}
