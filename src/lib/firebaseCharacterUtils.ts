import type { ModelFileFormat, RigDiagnostics } from '../../shared/characters';

export const FIRESTORE_MAX_RAW_CHUNK_BYTES = 480_000; // ~640 KB base64 (< 750 KB rule cap & < 1 MiB doc cap)
export const FIRESTORE_MAX_CHUNK_COUNT = 40; // ~19.2 MiB normalized GLB binary budget

export function validateRiggedCharacterOnly(
  diagnostics: RigDiagnostics,
  format: ModelFileFormat | null
): { valid: true } | { valid: false; reason: string } {
  if (format === 'obj') {
    return {
      valid: false,
      reason:
        'Only rigged characters are valid. OBJ geometry files contain no skeleton bones or skin weights—export rigged characters as .glb or .fbx with armature & skin weights.',
    };
  }
  if (!diagnostics.hasSkinWeights || diagnostics.boneCount < 1 || diagnostics.skinnedMeshCount < 1) {
    return {
      valid: false,
      reason: `Only rigged characters are valid. Detected ${diagnostics.boneCount} bones and ${diagnostics.skinnedMeshCount} skinned meshes—upload a character with bones and skin weights.`,
    };
  }
  return { valid: true };
}

export function sanitizeFirestoreId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 100);
  return cleaned || `char_${Date.now()}`;
}

export function sliceBytesToBase64Chunks(
  bytes: Uint8Array,
  maxRawChunkBytes: number = FIRESTORE_MAX_RAW_CHUNK_BYTES
): string[] {
  if (bytes.byteLength === 0) {
    throw new Error('Cannot persist empty character binary.');
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += maxRawChunkBytes) {
    const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + maxRawChunkBytes));
    chunks.push(uint8ToBase64(slice));
  }
  if (chunks.length > FIRESTORE_MAX_CHUNK_COUNT) {
    throw new Error(
      `Exported rigged GLB (${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MiB) exceeds Firestore chunk storage capacity (${FIRESTORE_MAX_CHUNK_COUNT} chunks ≈ 19 MiB). Optimize textures or mesh density before saving forever.`
    );
  }
  return chunks;
}

export function reassembleBase64ChunksToBytes(
  chunks: Array<{ chunkIndex: number; dataBase64: string }>
): Uint8Array {
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const arrays = sorted.map((c) => base64ToUint8(c.dataBase64));
  const totalLen = arrays.reduce((acc, a) => acc + a.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
