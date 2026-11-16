import * as THREE from 'three';
import type { BoneRotationMap, Vec3Tuple } from '../../../shared/studio';
import type { FingerControlsState, FingerName, HandPresetId, HandPoseControlState } from '../../../shared/pose-raster';
import { discoverFingerChains, mapBonesToRoles, collectSkeletonBones } from './rigInspect';

export interface RestPoseSnapshot {
  quaternions: Map<string, THREE.Quaternion>;
  positions: Map<string, THREE.Vector3>;
}

export function captureRestPose(root: THREE.Object3D): RestPoseSnapshot {
  const quaternions = new Map<string, THREE.Quaternion>();
  const positions = new Map<string, THREE.Vector3>();
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone && obj.name) {
      quaternions.set(obj.name, obj.quaternion.clone());
      positions.set(obj.name, obj.position.clone());
    }
  });
  return { quaternions, positions };
}

export function getHandPresetValues(preset: HandPresetId, current: HandPoseControlState): HandPoseControlState {
  switch (preset) {
    case 'open':
      return { ...current, curl: -0.05, spread: 0.35, thumbOpposed: 0.1, customFingerOverrides: {} };
    case 'fist':
      return { ...current, curl: 1.2, spread: 0.0, thumbOpposed: 0.75, customFingerOverrides: {} };
    case 'point':
      return {
        ...current,
        curl: 1.15,
        spread: 0.05,
        thumbOpposed: 0.55,
        customFingerOverrides: { index: -0.05 },
      };
    case 'relaxed':
    default:
      return { ...current, curl: 0.28, spread: 0.08, thumbOpposed: 0.25, customFingerOverrides: {} };
  }
}

export function applyBoneRotationsFromRest(
  root: THREE.Object3D,
  restPose: RestPoseSnapshot,
  rotations: BoneRotationMap,
  fingerControls?: FingerControlsState,
  bonePositions?: BoneRotationMap
): { missingFingerBones: string[] } {
  const bones = collectSkeletonBones(root);
  const deltaEuler = new THREE.Euler();
  const deltaQuat = new THREE.Quaternion();

  // First reset all bones strictly to their native rest frame + explicit body rotation & position offsets
  for (const bone of bones) {
    const restQ = restPose.quaternions.get(bone.name);
    const restP = restPose.positions.get(bone.name);
    if (restQ) bone.quaternion.copy(restQ);
    if (restP) {
      const posOffset = bonePositions?.[bone.name];
      if (posOffset) {
        bone.position.set(restP.x + posOffset.x, restP.y + posOffset.y, restP.z + posOffset.z);
      } else {
        bone.position.copy(restP);
      }
    }

    const rot = rotations[bone.name];
    if (rot) {
      deltaEuler.set(rot.x, rot.y, rot.z, 'XYZ');
      deltaQuat.setFromEuler(deltaEuler);
      bone.quaternion.multiply(deltaQuat);
    }
  }

  const missingFingerBones: string[] = [];

  // Apply safe finger chain curling/spread if finger bones actually exist
  if (fingerControls) {
    const chains = discoverFingerChains(bones);
    for (const side of ['left', 'right'] as const) {
      const handState = fingerControls[side];
      const fingerNames: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'little'];
      const spreadFactors: Record<FingerName, number> = {
        thumb: -0.8,
        index: -0.45,
        middle: 0,
        ring: 0.4,
        little: 0.85,
      };

      let anySideFinger = false;
      for (const fName of fingerNames) {
        const list = chains[side][fName];
        if (list.length === 0) continue;
        anySideFinger = true;

        const baseCurl =
          typeof handState.customFingerOverrides[fName] === 'number'
            ? handState.customFingerOverrides[fName]!
            : fName === 'thumb'
            ? handState.thumbOpposed
            : handState.curl;

        list.forEach((bone, jIdx) => {
          // If the user explicitly rotated this specific finger bone manually, add curl gently
          const curlAngle = baseCurl * (jIdx === 0 ? 0.75 : 0.9) * handState.sign;
          const spreadAngle =
            jIdx === 0 ? handState.spread * spreadFactors[fName] * (side === 'left' ? 1 : -1) : 0;

          const ex = handState.axis === 'x' ? curlAngle : 0;
          const ey = handState.axis === 'y' ? curlAngle : spreadAngle;
          const ez = handState.axis === 'z' ? curlAngle : 0;

          deltaEuler.set(ex, ey, ez, 'XYZ');
          deltaQuat.setFromEuler(deltaEuler);
          bone.quaternion.multiply(deltaQuat);
        });
      }

      if (!anySideFinger) {
        missingFingerBones.push(`${side} hand finger bones`);
      }
    }
  }

  root.updateMatrixWorld(true);
  return { missingFingerBones };
}

/**
 * Deterministic analytical two-bone limb IK solver returning upper & lower local delta angles.
 */
export function solveTwoBoneLimbAngles(params: {
  rootPos: Vec3Tuple;
  midPos: Vec3Tuple;
  endPos: Vec3Tuple;
  targetPos: Vec3Tuple;
  respectBendLimits: boolean;
  limbKind: 'arm' | 'leg';
}): { upperDelta: Vec3Tuple; lowerDelta: Vec3Tuple; reachRatio: number } {
  const r = new THREE.Vector3(params.rootPos.x, params.rootPos.y, params.rootPos.z);
  const m = new THREE.Vector3(params.midPos.x, params.midPos.y, params.midPos.z);
  const e = new THREE.Vector3(params.endPos.x, params.endPos.y, params.endPos.z);
  const t = new THREE.Vector3(params.targetPos.x, params.targetPos.y, params.targetPos.z);

  const l1 = Math.max(r.distanceTo(m), 0.05);
  const l2 = Math.max(m.distanceTo(e), 0.05);
  const toTarget = t.clone().sub(r);
  const dist = THREE.MathUtils.clamp(toTarget.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.01);

  // Law of cosines for elbow/knee interior flexion angle
  const cosKnee = THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1);
  let bendAngle = Math.PI - Math.acos(cosKnee);
  if (params.respectBendLimits) {
    bendAngle = THREE.MathUtils.clamp(bendAngle, 0.04, 2.45);
  }

  // Elevation & azimuth toward target
  const dir = toTarget.clone().normalize();
  const cosShoulder = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const offsetAngle = Math.acos(cosShoulder);

  if (params.limbKind === 'leg') {
    // Leg rest vector points down (0, -1, 0)
    const pitch = Math.atan2(dir.z, -dir.y) - offsetAngle * 0.5;
    const roll = Math.atan2(dir.x, Math.max(0.15, Math.hypot(dir.y, dir.z)));
    return {
      upperDelta: {
        x: params.respectBendLimits ? THREE.MathUtils.clamp(pitch, -1.9, 1.3) : pitch,
        y: 0,
        z: params.respectBendLimits ? THREE.MathUtils.clamp(roll, -0.8, 0.8) : roll,
      },
      lowerDelta: {
        x: bendAngle,
        y: 0,
        z: 0,
      },
      reachRatio: dist / (l1 + l2),
    };
  }

  // Arm rest vector points outward along +-X
  const isLeft = m.x >= r.x;
  const sideSign = isLeft ? 1 : -1;
  const forwardPitch = Math.atan2(dir.z, Math.max(0.1, Math.abs(dir.x) + Math.abs(dir.y)));
  const verticalRoll = Math.atan2(dir.y, Math.max(0.1, Math.abs(dir.x))) * sideSign;

  return {
    upperDelta: {
      x: params.respectBendLimits ? THREE.MathUtils.clamp(-forwardPitch, -1.9, 1.9) : -forwardPitch,
      y: sideSign * offsetAngle * 0.4,
      z: verticalRoll - sideSign * 0.3,
    },
    lowerDelta: {
      x: 0,
      y: -sideSign * bendAngle,
      z: 0,
    },
    reachRatio: dist / (l1 + l2),
  };
}

export function solveIkTargetForRig(
  root: THREE.Object3D,
  restPose: RestPoseSnapshot,
  limb: 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot',
  target: Vec3Tuple,
  respectBendLimits: boolean
): { patch: BoneRotationMap; reachRatio: number; warning?: string } {
  const bones = collectSkeletonBones(root);
  const roles = mapBonesToRoles(bones);

  const upperRole =
    limb === 'leftHand'
      ? 'leftUpperArm'
      : limb === 'rightHand'
      ? 'rightUpperArm'
      : limb === 'leftFoot'
      ? 'leftUpLeg'
      : 'rightUpLeg';
  const lowerRole =
    limb === 'leftHand'
      ? 'leftForeArm'
      : limb === 'rightHand'
      ? 'rightForeArm'
      : limb === 'leftFoot'
      ? 'leftLeg'
      : 'rightLeg';
  const endRole =
    limb === 'leftHand'
      ? 'leftHand'
      : limb === 'rightHand'
      ? 'rightHand'
      : limb === 'leftFoot'
      ? 'leftFoot'
      : 'rightFoot';

  const upperBone = roles[upperRole];
  const lowerBone = roles[lowerRole];
  const endBone = roles[endRole];

  if (!upperBone || !lowerBone || !endBone) {
    return {
      patch: {},
      reachRatio: 0,
      warning: `Missing ${upperRole}/${lowerRole}/${endRole} bones for IK solving.`,
    };
  }

  // Temporarily evaluate rest world positions cleanly
  const saved = new Map<string, THREE.Quaternion>();
  for (const b of [upperBone, lowerBone, endBone]) {
    saved.set(b.name, b.quaternion.clone());
    const rq = restPose.quaternions.get(b.name);
    if (rq) b.quaternion.copy(rq);
  }
  root.updateMatrixWorld(true);

  const rootPos = new THREE.Vector3();
  const midPos = new THREE.Vector3();
  const endPos = new THREE.Vector3();
  upperBone.getWorldPosition(rootPos);
  lowerBone.getWorldPosition(midPos);
  endBone.getWorldPosition(endPos);

  for (const b of [upperBone, lowerBone, endBone]) {
    const sq = saved.get(b.name);
    if (sq) b.quaternion.copy(sq);
  }
  root.updateMatrixWorld(true);

  const solved = solveTwoBoneLimbAngles({
    rootPos: { x: rootPos.x, y: rootPos.y, z: rootPos.z },
    midPos: { x: midPos.x, y: midPos.y, z: midPos.z },
    endPos: { x: endPos.x, y: endPos.y, z: endPos.z },
    targetPos: target,
    respectBendLimits,
    limbKind: limb.includes('Hand') ? 'arm' : 'leg',
  });

  return {
    patch: {
      [upperBone.name]: solved.upperDelta,
      [lowerBone.name]: solved.lowerDelta,
    },
    reachRatio: solved.reachRatio,
  };
}
