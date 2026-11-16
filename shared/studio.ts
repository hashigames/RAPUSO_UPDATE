export const ACTIVE_WORKSPACE_IDS = [
  'animation',
  'characters',
  'pose',
  'poseLibrary',
  'assets',
] as const;

export type WorkspaceId = (typeof ACTIVE_WORKSPACE_IDS)[number];

export const REMOVED_WORKSPACE_IDS = [
  'aiVideo',
  'motionReference',
  'customCharacter',
] as const;

export type LanguageCode = 'en' | 'ja';
export type ThemeMode = 'indigo' | 'graphite';
export type MaterialMode = 'original' | 'toon' | 'clay' | 'wire';
export type CameraPreset = 'perspective' | 'front' | 'side' | 'back';
export type TimelineMode = 'clips' | 'pose_keyframes';

export const MIN_TIMELINE_DURATION_SEC = 1;
export const MAX_TIMELINE_DURATION_SEC = 600;

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface Transform3D {
  position: Vec3Tuple;
  rotation: Vec3Tuple; // radians
  scale: Vec3Tuple;
}

export interface BoneRotationMap {
  [boneName: string]: Vec3Tuple; // Euler XYZ radians relative to rest pose
}

export interface NamedPose {
  id: string;
  name: string;
  createdAt: string;
  boneRotations: BoneRotationMap;
  source?: 'manual' | 'mannequin' | 'pose_library' | 'reference_2d' | 'preset';
  sourcePoseId?: string;
}

export interface PoseKeyframe {
  id: string;
  timeSec: number;
  label: string;
  boneRotations: BoneRotationMap;
}

export interface TimelineClipItem {
  id: string;
  sourceClipName: string;
  label: string;
  startSec: number;
  durationSec: number;
  speed: number;
  loop: boolean;
  sourceKind: 'preset' | 'embedded' | 'rapusomotion';
}

export interface PropAttachment {
  id: string;
  name: string;
  assetId: string;
  attachedBoneName: string | null; // null => static world prop
  visible: boolean;
  transform: Transform3D;
}

export interface EnvironmentBackground {
  id: string;
  name: string;
  dataUrlOrPath: string;
  is3DStaticScene?: boolean;
}

export interface SceneCameraState {
  preset: CameraPreset;
  position: Vec3Tuple;
  target: Vec3Tuple;
  fov: number;
}

export interface MaterialAppearanceSettings {
  mode: MaterialMode;
  tintHex: string;
  roughness: number;
  metalness: number;
  showSkeleton: boolean;
}

export interface PortableProjectManifest {
  version: 2;
  id: string;
  name: string;
  language: LanguageCode;
  theme: ThemeMode;
  updatedAt: string;
  characterId: string | null;
  timelineMode: TimelineMode;
  timelineDurationSec: number;
  playbackSpeed: number;
  loopPlayback: boolean;
  clips: TimelineClipItem[];
  poseKeyframes: PoseKeyframe[];
  savedPoses: NamedPose[];
  activeBoneRotations: BoneRotationMap;
  props: PropAttachment[];
  environmentId: string | null;
  material: MaterialAppearanceSettings;
  camera: SceneCameraState;
  // Preserved legacy compatibility fields (never surfaced as removed menus)
  legacyCustomization?: Record<string, unknown>;
  legacyReferenceClips?: unknown[];
}

export function isActiveWorkspaceId(value: string): value is WorkspaceId {
  return (ACTIVE_WORKSPACE_IDS as readonly string[]).includes(value);
}

export function isRemovedWorkspaceId(value: string): boolean {
  return (REMOVED_WORKSPACE_IDS as readonly string[]).includes(value);
}

export function clampTimelineDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return 10;
  return Math.min(MAX_TIMELINE_DURATION_SEC, Math.max(MIN_TIMELINE_DURATION_SEC, Math.round(seconds)));
}

export function isFiniteVec3(v: Partial<Vec3Tuple> | null | undefined): v is Vec3Tuple {
  return (
    !!v &&
    typeof v.x === 'number' &&
    Number.isFinite(v.x) &&
    typeof v.y === 'number' &&
    Number.isFinite(v.y) &&
    typeof v.z === 'number' &&
    Number.isFinite(v.z)
  );
}

export function sanitizeTransform3D(
  input?: Partial<Transform3D>,
  defaultScale: number = 1
): Transform3D {
  return {
    position: isFiniteVec3(input?.position) ? input!.position : { x: 0, y: 0, z: 0 },
    rotation: isFiniteVec3(input?.rotation) ? input!.rotation : { x: 0, y: 0, z: 0 },
    scale: isFiniteVec3(input?.scale)
      ? {
          x: Math.abs(input!.scale.x) < 1e-4 ? 0.01 : input!.scale.x,
          y: Math.abs(input!.scale.y) < 1e-4 ? 0.01 : input!.scale.y,
          z: Math.abs(input!.scale.z) < 1e-4 ? 0.01 : input!.scale.z,
        }
      : { x: defaultScale, y: defaultScale, z: defaultScale },
  };
}

export function sanitizeProjectManifest(raw: unknown): PortableProjectManifest {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  return {
    version: 2,
    id: typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `proj-${Date.now()}`,
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Untitled RAPUSO Scene',
    language: obj.language === 'ja' ? 'ja' : 'en',
    theme: obj.theme === 'graphite' ? 'graphite' : 'indigo',
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : now,
    characterId: typeof obj.characterId === 'string' ? obj.characterId : null,
    timelineMode: obj.timelineMode === 'pose_keyframes' ? 'pose_keyframes' : 'clips',
    timelineDurationSec: clampTimelineDuration(
      typeof obj.timelineDurationSec === 'number' ? obj.timelineDurationSec : 12
    ),
    playbackSpeed:
      typeof obj.playbackSpeed === 'number' && Number.isFinite(obj.playbackSpeed)
        ? Math.min(4, Math.max(0.1, obj.playbackSpeed))
        : 1,
    loopPlayback: typeof obj.loopPlayback === 'boolean' ? obj.loopPlayback : true,
    clips: Array.isArray(obj.clips) ? (obj.clips as TimelineClipItem[]) : [],
    poseKeyframes: Array.isArray(obj.poseKeyframes) ? (obj.poseKeyframes as PoseKeyframe[]) : [],
    savedPoses: Array.isArray(obj.savedPoses) ? (obj.savedPoses as NamedPose[]) : [],
    activeBoneRotations:
      obj.activeBoneRotations && typeof obj.activeBoneRotations === 'object'
        ? (obj.activeBoneRotations as BoneRotationMap)
        : {},
    props: Array.isArray(obj.props) ? (obj.props as PropAttachment[]) : [],
    environmentId: typeof obj.environmentId === 'string' ? obj.environmentId : null,
    material:
      obj.material && typeof obj.material === 'object'
        ? {
            mode: (['original', 'toon', 'clay', 'wire'].includes(
              String((obj.material as Record<string, unknown>).mode)
            )
              ? (obj.material as Record<string, unknown>).mode
              : 'original') as MaterialMode,
            tintHex:
              typeof (obj.material as Record<string, unknown>).tintHex === 'string'
                ? ((obj.material as Record<string, unknown>).tintHex as string)
                : '#ffffff',
            roughness:
              typeof (obj.material as Record<string, unknown>).roughness === 'number'
                ? Math.min(1, Math.max(0, (obj.material as Record<string, unknown>).roughness as number))
                : 0.55,
            metalness:
              typeof (obj.material as Record<string, unknown>).metalness === 'number'
                ? Math.min(1, Math.max(0, (obj.material as Record<string, unknown>).metalness as number))
                : 0.05,
            showSkeleton:
              typeof (obj.material as Record<string, unknown>).showSkeleton === 'boolean'
                ? ((obj.material as Record<string, unknown>).showSkeleton as boolean)
                : false,
          }
        : {
            mode: 'original',
            tintHex: '#ffffff',
            roughness: 0.55,
            metalness: 0.05,
            showSkeleton: false,
          },
    camera:
      obj.camera && typeof obj.camera === 'object'
        ? {
            preset: (['perspective', 'front', 'side', 'back'].includes(
              String((obj.camera as Record<string, unknown>).preset)
            )
              ? (obj.camera as Record<string, unknown>).preset
              : 'perspective') as CameraPreset,
            position: isFiniteVec3((obj.camera as Record<string, unknown>).position as Vec3Tuple)
              ? ((obj.camera as Record<string, unknown>).position as Vec3Tuple)
              : { x: 0, y: 1.35, z: 3.4 },
            target: isFiniteVec3((obj.camera as Record<string, unknown>).target as Vec3Tuple)
              ? ((obj.camera as Record<string, unknown>).target as Vec3Tuple)
              : { x: 0, y: 0.95, z: 0 },
            fov:
              typeof (obj.camera as Record<string, unknown>).fov === 'number'
                ? Math.min(85, Math.max(20, (obj.camera as Record<string, unknown>).fov as number))
                : 38,
          }
        : {
            preset: 'perspective',
            position: { x: 0, y: 1.35, z: 3.4 },
            target: { x: 0, y: 0.95, z: 0 },
            fov: 38,
          },
    ...(obj.legacyCustomization && typeof obj.legacyCustomization === 'object'
      ? { legacyCustomization: obj.legacyCustomization as Record<string, unknown> }
      : {}),
    ...(Array.isArray(obj.legacyReferenceClips)
      ? { legacyReferenceClips: obj.legacyReferenceClips }
      : {}),
  };
}
