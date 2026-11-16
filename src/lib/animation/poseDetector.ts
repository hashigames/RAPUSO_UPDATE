import type { PoseLandmarkPoint } from '../../../shared/pose-raster';

const KEY_JOINTS = [
  { index: 0, name: 'Nose' },
  { index: 11, name: 'Left Shoulder' },
  { index: 12, name: 'Right Shoulder' },
  { index: 13, name: 'Left Elbow' },
  { index: 14, name: 'Right Elbow' },
  { index: 15, name: 'Left Wrist' },
  { index: 16, name: 'Right Wrist' },
  { index: 23, name: 'Left Hip' },
  { index: 24, name: 'Right Hip' },
  { index: 25, name: 'Left Knee' },
  { index: 26, name: 'Right Knee' },
  { index: 27, name: 'Left Ankle' },
  { index: 28, name: 'Right Ankle' },
] as const;

export interface StillPoseDetectionResult {
  subjectsCount: number;
  landmarks: PoseLandmarkPoint[];
  confidenceMean: number;
  missingJoints: string[];
  detectionSource: 'mediapipe_image' | 'manual';
  statusNote: string;
}

let cachedLandmarker: unknown = null;

async function getOrCreateLandmarker() {
  if (cachedLandmarker) return cachedLandmarker;
  const vision = await import('@mediapipe/tasks-vision');
  const fileset = await vision.FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
  );
  const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'CPU',
    },
    runningMode: 'IMAGE',
    numPoses: 3,
    minPoseDetectionConfidence: 0.35,
    minPosePresenceConfidence: 0.35,
  });
  cachedLandmarker = landmarker;
  return landmarker;
}

export function createStarterManualLandmarks(): PoseLandmarkPoint[] {
  const defaults: Record<number, [number, number, number]> = {
    0: [0.5, 0.16, 0],
    11: [0.58, 0.28, 0],
    12: [0.42, 0.28, 0],
    13: [0.66, 0.42, 0],
    14: [0.34, 0.42, 0],
    15: [0.7, 0.56, 0],
    16: [0.3, 0.56, 0],
    23: [0.56, 0.54, 0],
    24: [0.44, 0.54, 0],
    25: [0.57, 0.74, 0],
    26: [0.43, 0.74, 0],
    27: [0.57, 0.92, 0],
    28: [0.43, 0.92, 0],
  };
  return KEY_JOINTS.map((j) => ({
    index: j.index,
    name: j.name,
    x: defaults[j.index][0],
    y: defaults[j.index][1],
    z: defaults[j.index][2],
    visibility: 0.9,
    editedManually: true,
  }));
}

export async function detectStillImagePose(
  imageUrl: string,
  subjectIndex: number = 0,
  signal?: AbortSignal
): Promise<StillPoseDetectionResult> {
  if (signal?.aborted) {
    throw new DOMException('Pose detection cancelled', 'AbortError');
  }

  const img = await loadImageElement(imageUrl, signal);
  if (signal?.aborted) {
    throw new DOMException('Pose detection cancelled', 'AbortError');
  }

  try {
    const landmarker = (await getOrCreateLandmarker()) as {
      detect: (el: HTMLImageElement) => {
        landmarks?: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>;
      };
    };
    if (signal?.aborted) {
      throw new DOMException('Pose detection cancelled', 'AbortError');
    }

    const res = landmarker.detect(img);
    const poses = res.landmarks || [];
    if (poses.length === 0) {
      return {
        subjectsCount: 0,
        landmarks: createStarterManualLandmarks(),
        confidenceMean: 0,
        missingJoints: KEY_JOINTS.map((j) => j.name),
        detectionSource: 'manual',
        statusNote:
          'MediaPipe found 0 poses (common for stylized line art or occluded anatomy). Loaded editable manual guides—drag dots to fit.',
      };
    }

    const chosen = poses[Math.min(subjectIndex, poses.length - 1)];
    const mapped: PoseLandmarkPoint[] = [];
    const missingJoints: string[] = [];
    let visSum = 0;

    for (const j of KEY_JOINTS) {
      const pt = chosen[j.index];
      const vis = pt?.visibility ?? 0.7;
      if (!pt || vis < 0.35) missingJoints.push(j.name);
      visSum += vis;
      mapped.push({
        index: j.index,
        name: j.name,
        x: pt?.x ?? 0.5,
        y: pt?.y ?? 0.5,
        z: pt?.z ?? 0,
        visibility: vis,
      });
    }

    return {
      subjectsCount: poses.length,
      landmarks: mapped,
      confidenceMean: visSum / KEY_JOINTS.length,
      missingJoints,
      detectionSource: 'mediapipe_image',
      statusNote:
        poses.length > 1
          ? `Detected ${poses.length} subjects; using subject #${Math.min(subjectIndex, poses.length - 1) + 1}.`
          : 'Detected 1 subject via MediaPipe IMAGE-mode PoseLandmarker.',
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return {
      subjectsCount: 0,
      landmarks: createStarterManualLandmarks(),
      confidenceMean: 0,
      missingJoints: KEY_JOINTS.map((j) => j.name),
      detectionSource: 'manual',
      statusNote:
        'MediaPipe model/WASM unavailable in offline/restricted context. Loaded editable manual guides.',
    };
  }
}

function loadImageElement(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const onAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    img.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Failed to load reference image for pose detection.'));
    };
    img.src = src;
  });
}
