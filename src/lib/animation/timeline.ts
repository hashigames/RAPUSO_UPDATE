import * as THREE from 'three';
import type { BoneRotationMap, PoseKeyframe, TimelineClipItem } from '../../../shared/studio';

/**
 * Deterministic quaternion SLERP sampling across saved PoseKeyframes.
 * Returns interpolated bone rotation deltas relative to target rig's native rest pose.
 */
export function samplePoseKeyframesAtTime(
  keyframes: PoseKeyframe[],
  timeSec: number
): BoneRotationMap {
  if (keyframes.length === 0) return {};
  const sorted = [...keyframes].sort((a, b) => a.timeSec - b.timeSec);
  if (sorted.length === 1 || timeSec <= sorted[0].timeSec) {
    return structuredCloneSafe(sorted[0].boneRotations);
  }
  const last = sorted[sorted.length - 1];
  if (timeSec >= last.timeSec) {
    return structuredCloneSafe(last.boneRotations);
  }

  let prev = sorted[0];
  let next = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (timeSec >= sorted[i].timeSec && timeSec <= sorted[i + 1].timeSec) {
      prev = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const span = Math.max(next.timeSec - prev.timeSec, 1e-4);
  const alpha = THREE.MathUtils.clamp((timeSec - prev.timeSec) / span, 0, 1);

  const allBoneNames = new Set<string>([
    ...Object.keys(prev.boneRotations),
    ...Object.keys(next.boneRotations),
  ]);

  const result: BoneRotationMap = {};
  const eA = new THREE.Euler();
  const eB = new THREE.Euler();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qOut = new THREE.Quaternion();
  const eOut = new THREE.Euler();

  for (const boneName of allBoneNames) {
    const rA = prev.boneRotations[boneName] ?? { x: 0, y: 0, z: 0 };
    const rB = next.boneRotations[boneName] ?? { x: 0, y: 0, z: 0 };
    eA.set(rA.x, rA.y, rA.z, 'XYZ');
    eB.set(rB.x, rB.y, rB.z, 'XYZ');
    qA.setFromEuler(eA);
    qB.setFromEuler(eB);
    qOut.slerpQuaternions(qA, qB, alpha);
    eOut.setFromQuaternion(qOut, 'XYZ');
    result[boneName] = {
      x: eOut.x,
      y: eOut.y,
      z: eOut.z,
    };
  }

  return result;
}

export function resolveActiveClipAtTime(
  clips: TimelineClipItem[],
  timeSec: number
): { clip: TimelineClipItem; localTimeSec: number } | null {
  for (const clip of clips) {
    const end = clip.startSec + clip.durationSec;
    if (timeSec >= clip.startSec && timeSec <= end) {
      const elapsed = (timeSec - clip.startSec) * clip.speed;
      return {
        clip,
        localTimeSec: elapsed,
      };
    }
  }
  return null;
}

function structuredCloneSafe(map: BoneRotationMap): BoneRotationMap {
  const out: BoneRotationMap = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = { x: v.x, y: v.y, z: v.z };
  }
  return out;
}
