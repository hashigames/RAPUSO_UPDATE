import type { PortableProjectManifest, LanguageCode } from '../../shared/studio';
import type { PortableCharacterManifest } from '../../shared/characters';
import type {
  AnimeShaderPreset,
  PoseCategory,
  PoseLibraryListResponse,
  PoseLibraryRecord,
} from '../../shared/pose-raster';
import type { MotionDirectionResult, RasterCritiqueResult } from '../../server/ai';

export async function fetchStudioHealth(): Promise<{
  ok: boolean;
  storageProvider: string;
  geminiConfigured: boolean;
}> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return res.json();
}

export async function listServerProjects(): Promise<PortableProjectManifest[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error('Failed to load server projects');
  const data = await res.json();
  return data.items || [];
}

export async function saveServerProject(
  project: PortableProjectManifest
): Promise<PortableProjectManifest> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save project');
  return data.project;
}

export async function deleteServerProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete project');
}

export async function listServerCharacters(): Promise<PortableCharacterManifest[]> {
  const res = await fetch('/api/characters');
  if (!res.ok) throw new Error('Failed to load saved characters');
  const data = await res.json();
  return data.items || [];
}

export async function saveServerCharacter(
  character: PortableCharacterManifest
): Promise<PortableCharacterManifest> {
  const res = await fetch('/api/characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(character),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save character record');
  return data.character;
}

export async function deleteServerCharacter(recordId: string): Promise<void> {
  const res = await fetch(`/api/characters/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete character record');
}

export interface PersistedRiggedCharacterDoc {
  id: string;
  name: string;
  sourceFormat: 'glb' | 'gltf' | 'fbx';
  primaryFileName: string;
  boneCount: number;
  skinnedMeshCount: number;
  hasSkinWeights: boolean;
  textureCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

export async function listPersistedRiggedCharacters(): Promise<PersistedRiggedCharacterDoc[]> {
  const res = await fetch('/api/rigged-characters');
  if (!res.ok) throw new Error('Failed to load saved rigged characters');
  const data = await res.json();
  return data.items || [];
}

export async function savePersistedRiggedCharacter(params: {
  manifest: PortableCharacterManifest;
  glbBytes: Uint8Array;
  onProgress?: (pct: number) => void;
}): Promise<PersistedRiggedCharacterDoc> {
  const { manifest, glbBytes, onProgress } = params;
  onProgress?.(15);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < glbBytes.length; i += step) {
    binary += String.fromCharCode(...glbBytes.subarray(i, i + step));
  }
  const dataBase64 = btoa(binary);
  onProgress?.(45);

  const safeFormat =
    manifest.format === 'fbx' ? 'fbx' : manifest.format === 'gltf' ? 'gltf' : 'glb';

  const res = await fetch('/api/rigged-characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: manifest.savedRecordId,
      name: manifest.name,
      sourceFormat: safeFormat,
      primaryFileName: manifest.primaryFileName,
      boneCount: manifest.diagnostics.boneCount,
      skinnedMeshCount: manifest.diagnostics.skinnedMeshCount,
      hasSkinWeights: manifest.diagnostics.hasSkinWeights,
      textureCount: manifest.textureBindings.length + manifest.companionFiles.length,
      dataBase64,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save rigged character');
  onProgress?.(100);
  return data.item as PersistedRiggedCharacterDoc;
}

export async function loadPersistedRiggedCharacterGlb(
  docItem: PersistedRiggedCharacterDoc
): Promise<{ bytes: Uint8Array; fileName: string; metadata: PersistedRiggedCharacterDoc }> {
  const res = await fetch(`/api/rigged-characters/${encodeURIComponent(docItem.id)}/glb`);
  if (!res.ok) throw new Error('Failed to load saved character binary');
  const buf = await res.arrayBuffer();
  const glbName = docItem.primaryFileName.replace(/\.(fbx|gltf)$/i, '') + '.glb';
  return {
    bytes: new Uint8Array(buf),
    fileName: glbName,
    metadata: docItem,
  };
}

export async function deletePersistedRiggedCharacter(id: string): Promise<void> {
  const res = await fetch(`/api/rigged-characters/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete saved character');
}

export async function listPoseLibrary(params: {
  search?: string;
  category?: 'all' | PoseCategory;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<PoseLibraryListResponse> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.category) qs.set('category', params.category);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));

  const res = await fetch(`/api/poses?${qs.toString()}`, { signal: params.signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load 2D poses library');
  return data;
}

export async function uploadPoseLibraryFile(params: {
  file: File;
  name?: string;
  reservationId?: string;
  autoClassify?: boolean;
  signal?: AbortSignal;
}): Promise<{ pose: PoseLibraryRecord; reservationId: string }> {
  const reserveRes = await fetch('/api/poses/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: params.signal,
    body: JSON.stringify({
      reservationId: params.reservationId,
      name: params.name || params.file.name.replace(/\.[^.]+$/, ''),
      mimeType: params.file.type || 'image/png',
      sizeBytes: params.file.size,
    }),
  });
  const reserveJson = await reserveRes.json();
  if (!reserveRes.ok) {
    throw new Error(reserveJson.error || 'Failed to reserve pose upload slot');
  }
  const reservationId: string = reserveJson.reservation.id;

  const bytes = await params.file.arrayBuffer();
  const uploadRes = await fetch(
    `/api/poses/upload-bytes/${encodeURIComponent(reservationId)}?autoClassify=${
      params.autoClassify !== false ? 'true' : 'false'
    }`,
    {
      method: 'PUT',
      headers: { 'Content-Type': params.file.type || 'image/png' },
      signal: params.signal,
      body: bytes,
    }
  );
  const uploadJson = await uploadRes.json();
  if (!uploadRes.ok) {
    throw new Error(uploadJson.error || 'Failed to store pose image bytes');
  }

  return { pose: uploadJson.pose, reservationId };
}

export async function updatePoseLibraryRecord(
  id: string,
  patch: { name?: string; category?: PoseCategory }
): Promise<PoseLibraryRecord> {
  const res = await fetch(`/api/poses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update pose metadata');
  return data.pose;
}

export async function reclassifyPoseLibraryRecord(id: string): Promise<PoseLibraryRecord> {
  const res = await fetch(`/api/poses/${encodeURIComponent(id)}/reclassify`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to classify pose image');
  return data.pose;
}

export async function deletePoseLibraryRecord(id: string): Promise<void> {
  const res = await fetch(`/api/poses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete pose record');
}

export async function directMotionRequest(params: {
  prompt: string;
  language: LanguageCode;
  availableClipNames: string[];
  hasSkinWeights: boolean;
}): Promise<MotionDirectionResult> {
  const res = await fetch('/api/ai/direct-motion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Motion planning request failed');
  return data;
}

export async function critiqueRasterRequest(params: {
  imageDataUrl: string;
  language: LanguageCode;
  currentPreset: AnimeShaderPreset;
}): Promise<RasterCritiqueResult> {
  const res = await fetch('/api/ai/critique-raster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AI Art Director critique failed');
  return data;
}

