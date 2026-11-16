import { Transform3D } from './studio';

export const MAX_SINGLE_FILE_BYTES = 128 * 1024 * 1024; // 128 MiB
export const MAX_BUNDLE_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MiB

export type ModelFileFormat = 'glb' | 'gltf' | 'fbx' | 'obj' | 'demo';
export type TextureMapChannel = 'baseColor' | 'normal' | 'roughness' | 'metallic';
export type UvChannelMode = 'auto' | 'uv0' | 'uv1';
export type FlipYMode = 'auto' | 'flip' | 'no-flip';
export type NormalYConvention = 'opengl' | 'directx';

export interface PbrTextureSlotBinding {
  id: string;
  channel: TextureMapChannel;
  fileName: string;
  dataUrlOrAssetId: string;
  targetMaterialSlot: string; // '__auto__' | '__all_atlas__' | exact material slot name
  uvChannel: UvChannelMode;
  flipY: FlipYMode;
  normalY: NormalYConvention;
}

export interface CharacterClipSetting {
  id: string;
  sourceName: string;
  label: string;
  durationSec: number;
  speed: number;
  loop: boolean;
  boundTrackCount: number;
  totalTrackCount: number;
  compatible: boolean;
  sourceKind: 'preset' | 'embedded' | 'uploaded_clip' | 'rapusomotion';
}

export interface CharacterCompanionFile {
  id: string;
  name: string;
  role: 'model' | 'texture' | 'animation' | 'companion';
  sizeBytes: number;
  mimeType: string;
}

export interface RigDiagnostics {
  meshCount: number;
  skinnedMeshCount: number;
  boneCount: number;
  vertexCount: number;
  triangleCount: number;
  materialSlotNames: string[];
  boneNames: string[];
  embeddedClipCount: number;
  morphTargetNames: string[];
  hasSkinWeights: boolean;
  hasArticulatedFingers: boolean;
  warnings: string[];
}

export interface LegacyCustomizationComponent {
  id: string;
  name: string;
  category: string;
  visible: boolean;
  attachedBoneName: string | null;
  transform: Transform3D;
}

export interface PortableCharacterManifest {
  id: string;
  name: string;
  format: ModelFileFormat;
  isBuiltInDemo: boolean;
  persistenceScope: 'bundled' | 'local_browser' | 'server_record';
  savedRecordId?: string;
  lastSavedAt?: string;
  primaryFileName: string;
  primaryFileSizeBytes: number;
  companionFiles: CharacterCompanionFile[];
  textureBindings: PbrTextureSlotBinding[];
  clipSettings: CharacterClipSetting[];
  diagnostics: RigDiagnostics;
  // Preserved optional customization metadata so older manifests load intact
  customization?: {
    baseMeshVisible?: boolean;
    morphWeights?: Record<string, number>;
    components?: LegacyCustomizationComponent[];
  };
}

export function validateBundleSizes(
  files: Array<{ name: string; sizeBytes: number }>
): { ok: true; totalBytes: number } | { ok: false; error: string } {
  let total = 0;
  for (const file of files) {
    if (!Number.isFinite(file.sizeBytes) || file.sizeBytes < 0) {
      return { ok: false, error: `Invalid file size for ${file.name}.` };
    }
    if (file.sizeBytes > MAX_SINGLE_FILE_BYTES) {
      return {
        ok: false,
        error: `${file.name} exceeds the 128 MiB per-file limit.`,
      };
    }
    total += file.sizeBytes;
  }
  if (total > MAX_BUNDLE_TOTAL_BYTES) {
    return {
      ok: false,
      error: `Bundle size (${(total / (1024 * 1024)).toFixed(1)} MiB) exceeds the 200 MiB bundle limit.`,
    };
  }
  return { ok: true, totalBytes: total };
}

export function detectModelFormat(fileName: string): ModelFileFormat | null {
  const lower = fileName.toLowerCase().trim();
  if (lower.endsWith('.glb')) return 'glb';
  if (lower.endsWith('.gltf')) return 'gltf';
  if (lower.endsWith('.fbx')) return 'fbx';
  if (lower.endsWith('.obj')) return 'obj';
  return null;
}
