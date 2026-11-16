import * as THREE from 'three';
import type { CharacterClipSetting, RigDiagnostics } from '../../../shared/characters';
import type { FingerName, HandSide } from '../../../shared/pose-raster';

export type CanonicalBoneRole =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'leftUpperArm'
  | 'leftForeArm'
  | 'leftHand'
  | 'rightShoulder'
  | 'rightUpperArm'
  | 'rightForeArm'
  | 'rightHand'
  | 'leftUpLeg'
  | 'leftLeg'
  | 'leftFoot'
  | 'leftToe'
  | 'rightUpLeg'
  | 'rightLeg'
  | 'rightFoot'
  | 'rightToe';

const IGNORED_HELPER_RE = /(twist|roll|helper|adj|corrective|_end$|end$|nub|ik|pole|target|socket)/;

function hasLeftTag(s: string): boolean {
  return (
    s.includes('left') ||
    /(^|[_\.\-\s:])l($|[_\.\-\s:0-9])/.test(s) ||
    s.includes('左')
  );
}

function hasRightTag(s: string): boolean {
  return (
    s.includes('right') ||
    /(^|[_\.\-\s:])r($|[_\.\-\s:0-9])/.test(s) ||
    s.includes('右')
  );
}

const ROLE_PATTERNS: Array<{ role: CanonicalBoneRole; test: (lower: string) => boolean }> = [
  {
    role: 'hips',
    test: (s) =>
      /^(mixamorig[:_]?)?(hips|pelvis|root|hip)$/.test(s) ||
      ((s.includes('hip') || s.includes('pelvis') || s.includes('腰') || s.includes('センター')) &&
        !s.includes('thigh')),
  },
  {
    role: 'chest',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      (s.includes('upperchest') ||
        s.includes('chest') ||
        s.includes('spine2') ||
        s.includes('spine1') ||
        s.includes('spine_02') ||
        s.includes('spine_03') ||
        s.includes('上半身2')),
  },
  {
    role: 'spine',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      ((s.includes('spine') && !s.includes('1') && !s.includes('2') && !s.includes('3')) ||
        s.includes('上半身')),
  },
  { role: 'neck', test: (s) => !IGNORED_HELPER_RE.test(s) && (s.includes('neck') || s.includes('首')) },
  {
    role: 'head',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      (s.includes('head') || s.includes('頭')) &&
      !s.includes('top'),
  },

  {
    role: 'leftShoulder',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasLeftTag(s) &&
      (s.includes('shoulder') || s.includes('clavicle') || s.includes('collar') || s.includes('肩')),
  },
  {
    role: 'leftUpperArm',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasLeftTag(s) &&
      (s.includes('upperarm') ||
        s.includes('upper_arm') ||
        s.includes('bicep') ||
        s.includes('腕') ||
        (s.includes('arm') && !s.includes('fore') && !s.includes('lower'))),
  },
  {
    role: 'leftForeArm',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasLeftTag(s) &&
      (s.includes('forearm') ||
        s.includes('fore_arm') ||
        s.includes('lowerarm') ||
        s.includes('lower_arm') ||
        s.includes('elbow') ||
        s.includes('ひじ')),
  },
  {
    role: 'leftHand',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasLeftTag(s) &&
      (s.endsWith('hand') || s.includes('hand') || s.includes('wrist') || s.includes('手首')) &&
      !s.includes('thumb') &&
      !s.includes('index') &&
      !s.includes('middle') &&
      !s.includes('ring') &&
      !s.includes('pinky') &&
      !s.includes('little'),
  },

  {
    role: 'rightShoulder',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasRightTag(s) &&
      (s.includes('shoulder') || s.includes('clavicle') || s.includes('collar') || s.includes('肩')),
  },
  {
    role: 'rightUpperArm',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasRightTag(s) &&
      (s.includes('upperarm') ||
        s.includes('upper_arm') ||
        s.includes('bicep') ||
        s.includes('腕') ||
        (s.includes('arm') && !s.includes('fore') && !s.includes('lower'))),
  },
  {
    role: 'rightForeArm',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasRightTag(s) &&
      (s.includes('forearm') ||
        s.includes('fore_arm') ||
        s.includes('lowerarm') ||
        s.includes('lower_arm') ||
        s.includes('elbow') ||
        s.includes('ひじ')),
  },
  {
    role: 'rightHand',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasRightTag(s) &&
      (s.endsWith('hand') || s.includes('hand') || s.includes('wrist') || s.includes('手首')) &&
      !s.includes('thumb') &&
      !s.includes('index') &&
      !s.includes('middle') &&
      !s.includes('ring') &&
      !s.includes('pinky') &&
      !s.includes('little'),
  },

  {
    role: 'leftUpLeg',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasLeftTag(s) &&
      (s.includes('upleg') ||
        s.includes('up_leg') ||
        s.includes('thigh') ||
        s.includes('upperleg') ||
        s.includes('upper_leg') ||
        s.includes('足')),
  },
  {
    role: 'leftLeg',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasLeftTag(s) &&
      ((s.includes('leg') && !s.includes('up')) ||
        s.includes('lowerleg') ||
        s.includes('lower_leg') ||
        s.includes('shin') ||
        s.includes('calf') ||
        s.includes('knee') ||
        s.includes('ひざ')),
  },
  {
    role: 'leftFoot',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasLeftTag(s) &&
      (s.includes('foot') || s.includes('ankle') || s.includes('足首')) &&
      !s.includes('toe'),
  },
  {
    role: 'leftToe',
    test: (s) => !IGNORED_HELPER_RE.test(s) && hasLeftTag(s) && (s.includes('toe') || s.includes('つま先')),
  },

  {
    role: 'rightUpLeg',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasRightTag(s) &&
      (s.includes('upleg') ||
        s.includes('up_leg') ||
        s.includes('thigh') ||
        s.includes('upperleg') ||
        s.includes('upper_leg') ||
        s.includes('足')),
  },
  {
    role: 'rightLeg',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasRightTag(s) &&
      ((s.includes('leg') && !s.includes('up')) ||
        s.includes('lowerleg') ||
        s.includes('lower_leg') ||
        s.includes('shin') ||
        s.includes('calf') ||
        s.includes('knee') ||
        s.includes('ひざ')),
  },
  {
    role: 'rightFoot',
    test: (s) =>
      !IGNORED_HELPER_RE.test(s) &&
      hasRightTag(s) &&
      (s.includes('foot') || s.includes('ankle') || s.includes('足首')) &&
      !s.includes('toe'),
  },
  {
    role: 'rightToe',
    test: (s) => !IGNORED_HELPER_RE.test(s) && hasRightTag(s) && (s.includes('toe') || s.includes('つま先')),
  },
];

export function mapBonesToRoles(bones: THREE.Bone[]): Partial<Record<CanonicalBoneRole, THREE.Bone>> {
  const result: Partial<Record<CanonicalBoneRole, THREE.Bone>> = {};
  for (const bone of bones) {
    const clean = bone.name.toLowerCase().replace(/\s+/g, '');
    for (const { role, test } of ROLE_PATTERNS) {
      if (!result[role] && test(clean)) {
        result[role] = bone;
        break;
      }
    }
  }
  return result;
}

export function discoverFingerChains(
  bones: THREE.Bone[]
): Record<HandSide, Record<FingerName, THREE.Bone[]>> {
  const chains: Record<HandSide, Record<FingerName, THREE.Bone[]>> = {
    left: { thumb: [], index: [], middle: [], ring: [], little: [] },
    right: { thumb: [], index: [], middle: [], ring: [], little: [] },
  };

  for (const bone of bones) {
    const s = bone.name.toLowerCase();
    const side: HandSide | null =
      s.includes('left') || s.includes('_l') || s.includes('.l') || s.startsWith('l_')
        ? 'left'
        : s.includes('right') || s.includes('_r') || s.includes('.r') || s.startsWith('r_')
        ? 'right'
        : null;
    if (!side) continue;

    let finger: FingerName | null = null;
    if (s.includes('thumb')) finger = 'thumb';
    else if (s.includes('index')) finger = 'index';
    else if (s.includes('middle')) finger = 'middle';
    else if (s.includes('ring')) finger = 'ring';
    else if (s.includes('little') || s.includes('pinky')) finger = 'little';

    if (finger) {
      chains[side][finger].push(bone);
    }
  }

  // Sort each finger chain by name length / digit index so proximal -> distal
  for (const side of ['left', 'right'] as const) {
    for (const finger of ['thumb', 'index', 'middle', 'ring', 'little'] as const) {
      chains[side][finger].sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return chains;
}

export function collectSkeletonBones(root: THREE.Object3D): THREE.Bone[] {
  const seen = new Set<THREE.Bone>();
  const bones: THREE.Bone[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone && !seen.has(obj as THREE.Bone)) {
      seen.add(obj as THREE.Bone);
      bones.push(obj as THREE.Bone);
    }
  });
  return bones;
}

export function inspectObject3D(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[] = []
): RigDiagnostics {
  let meshCount = 0;
  let skinnedMeshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let hasSkinWeights = false;

  const materialSlotSet = new Set<string>();
  const morphSet = new Set<string>();
  const boneSet = new Set<THREE.Bone>();

  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) {
      boneSet.add(obj as THREE.Bone);
    }
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      meshCount += 1;
      const geo = mesh.geometry;
      if (geo) {
        const pos = geo.getAttribute('position');
        if (pos) vertexCount += pos.count;
        const idx = geo.getIndex();
        if (idx) triangleCount += Math.floor(idx.count / 3);
        else if (pos) triangleCount += Math.floor(pos.count / 3);

        const sw = geo.getAttribute('skinWeight');
        const si = geo.getAttribute('skinIndex');
        if (sw && si && sw.count > 0) {
          hasSkinWeights = true;
        }
      }
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        skinnedMeshCount += 1;
        const skel = (mesh as THREE.SkinnedMesh).skeleton;
        if (skel) {
          for (const b of skel.bones) boneSet.add(b);
        }
      }

      if (mesh.morphTargetDictionary) {
        for (const key of Object.keys(mesh.morphTargetDictionary)) {
          morphSet.add(key);
        }
      }

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m, i) => {
        if (m) {
          materialSlotSet.add(m.name && m.name.trim() ? m.name.trim() : `${mesh.name || 'Mesh'}_Mat_${i}`);
        }
      });
    }
  });

  const bones = Array.from(boneSet);
  const fingerChains = discoverFingerChains(bones);
  const hasArticulatedFingers =
    Object.values(fingerChains.left).some((c) => c.length > 0) ||
    Object.values(fingerChains.right).some((c) => c.length > 0);

  const warnings: string[] = [];
  if (skinnedMeshCount === 0 || !hasSkinWeights) {
    warnings.push('This mesh has no skin weights; upload a skinned character to pose its elbow.');
  }
  if (bones.length === 0) {
    warnings.push('No skeleton bones found; static OBJ/meshes can only be positioned as props or environments.');
  } else if (!hasArticulatedFingers) {
    warnings.push('No finger bone chains detected; finger controls require an articulated hand rig with skin weights.');
  }
  if (clips.length === 0 && bones.length > 0) {
    warnings.push('No embedded animation clips found; upload FBX/GLB motion files or author in Pose keyframes only mode.');
  }

  return {
    meshCount,
    skinnedMeshCount,
    boneCount: bones.length,
    vertexCount,
    triangleCount,
    materialSlotNames: Array.from(materialSlotSet),
    boneNames: bones.map((b) => b.name),
    embeddedClipCount: clips.length,
    morphTargetNames: Array.from(morphSet),
    hasSkinWeights: skinnedMeshCount > 0 && hasSkinWeights,
    hasArticulatedFingers,
    warnings,
  };
}

export function evaluateClipCompatibility(
  clip: THREE.AnimationClip,
  root: THREE.Object3D,
  sourceKind: CharacterClipSetting['sourceKind'] = 'embedded'
): CharacterClipSetting {
  const objectNames = new Set<string>();
  root.traverse((obj) => {
    if (obj.name) objectNames.add(obj.name);
  });

  let boundTrackCount = 0;
  for (const track of clip.tracks) {
    const dotIdx = track.name.indexOf('.');
    const targetName = dotIdx >= 0 ? track.name.slice(0, dotIdx) : track.name;
    // Handle Three.js slash or bracket paths if any
    const cleanTarget = targetName.split('/').pop()?.replace(/[\[\]]/g, '') || targetName;
    if (objectNames.has(cleanTarget) || objectNames.has(targetName)) {
      boundTrackCount += 1;
    }
  }

  return {
    id: `clip-${clip.name}-${clip.duration.toFixed(2)}`,
    sourceName: clip.name,
    label: clip.name,
    durationSec: Number(clip.duration.toFixed(3)),
    speed: 1,
    loop: true,
    boundTrackCount,
    totalTrackCount: clip.tracks.length,
    compatible: boundTrackCount > 0,
    sourceKind,
  };
}
