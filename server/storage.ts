import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PortableProjectManifest } from '../shared/studio';
import type { PortableCharacterManifest } from '../shared/characters';
import {
  normalizePoseCategory,
  type PoseCategory,
  type PoseLibraryListResponse,
  type PoseLibraryRecord,
} from '../shared/pose-raster';

export interface StoredPoseInternal extends PoseLibraryRecord {
  status: 'pending' | 'ready';
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

export class StudioFileStore {
  private baseDir: string;
  private objectsDir: string;
  private riggedCharsDir: string;
  private projectsPath: string;
  private charactersPath: string;
  private riggedCharsPath: string;
  private posesPath: string;

  constructor(baseDir: string = path.resolve(process.cwd(), '.rapuso-data')) {
    this.baseDir = baseDir;
    this.objectsDir = path.join(baseDir, 'pose-objects');
    this.riggedCharsDir = path.join(baseDir, 'rigged-characters');
    this.projectsPath = path.join(baseDir, 'projects.json');
    this.charactersPath = path.join(baseDir, 'characters.json');
    this.riggedCharsPath = path.join(baseDir, 'rigged-characters.json');
    this.posesPath = path.join(baseDir, 'poses.json');
  }

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.objectsDir, { recursive: true });
    await fs.mkdir(this.riggedCharsDir, { recursive: true });
  }

  private async readJsonArray<T>(filePath: string): Promise<T[]> {
    try {
      const txt = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(txt);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private async writeJsonArray<T>(filePath: string, data: T[]): Promise<void> {
    await this.ensureDirs();
    const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, filePath);
  }

  // ---- Projects ----
  async listProjects(): Promise<PortableProjectManifest[]> {
    const list = await this.readJsonArray<PortableProjectManifest>(this.projectsPath);
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveProject(project: PortableProjectManifest): Promise<PortableProjectManifest> {
    const list = await this.readJsonArray<PortableProjectManifest>(this.projectsPath);
    const updated: PortableProjectManifest = {
      ...project,
      updatedAt: new Date().toISOString(),
    };
    const idx = list.findIndex((p) => p.id === updated.id);
    if (idx >= 0) list[idx] = updated;
    else list.unshift(updated);
    await this.writeJsonArray(this.projectsPath, list);
    return updated;
  }

  async deleteProject(id: string): Promise<boolean> {
    const list = await this.readJsonArray<PortableProjectManifest>(this.projectsPath);
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    await this.writeJsonArray(this.projectsPath, next);
    return true;
  }

  // ---- Characters ----
  async listCharacters(): Promise<PortableCharacterManifest[]> {
    const list = await this.readJsonArray<PortableCharacterManifest>(this.charactersPath);
    return list.sort((a, b) => (b.lastSavedAt || '').localeCompare(a.lastSavedAt || ''));
  }

  async saveCharacter(char: PortableCharacterManifest): Promise<PortableCharacterManifest> {
    const list = await this.readJsonArray<PortableCharacterManifest>(this.charactersPath);
    const recordId = char.savedRecordId || `char-${crypto.randomUUID().slice(0, 8)}`;
    const updated: PortableCharacterManifest = {
      ...char,
      persistenceScope: 'server_record',
      savedRecordId: recordId,
      lastSavedAt: new Date().toISOString(),
    };
    const idx = list.findIndex((c) => c.savedRecordId === recordId || c.id === updated.id);
    if (idx >= 0) list[idx] = updated;
    else list.unshift(updated);
    await this.writeJsonArray(this.charactersPath, list);
    return updated;
  }

  async deleteCharacter(recordId: string): Promise<boolean> {
    const list = await this.readJsonArray<PortableCharacterManifest>(this.charactersPath);
    const next = list.filter((c) => c.savedRecordId !== recordId && c.id !== recordId);
    if (next.length === list.length) return false;
    await this.writeJsonArray(this.charactersPath, next);
    return true;
  }

  // ---- Persisted Rigged Characters (GLB binary + metadata) ----
  async listRiggedCharacters(): Promise<PersistedRiggedCharacterDoc[]> {
    const list = await this.readJsonArray<PersistedRiggedCharacterDoc>(this.riggedCharsPath);
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveRiggedCharacter(params: {
    id?: string;
    name: string;
    sourceFormat: string;
    primaryFileName: string;
    boneCount: number;
    skinnedMeshCount: number;
    hasSkinWeights: boolean;
    textureCount: number;
    glbBytes: Buffer;
  }): Promise<PersistedRiggedCharacterDoc> {
    if (!['glb', 'gltf', 'fbx'].includes(params.sourceFormat)) {
      throw new Error('Only rigged .glb, .gltf, or .fbx characters are valid.');
    }
    if (!params.hasSkinWeights || params.boneCount < 1 || params.skinnedMeshCount < 1) {
      throw new Error('Only rigged characters with bones and skin weights are valid.');
    }
    if (!params.glbBytes || params.glbBytes.byteLength === 0) {
      throw new Error('Cannot save empty character binary.');
    }

    await this.ensureDirs();
    const list = await this.readJsonArray<PersistedRiggedCharacterDoc>(this.riggedCharsPath);
    const safeId = (params.id || `char_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .slice(0, 100);
    const now = new Date().toISOString();
    const existing = list.find((item) => item.id === safeId);

    const record: PersistedRiggedCharacterDoc = {
      id: safeId,
      name: params.name.trim().slice(0, 120) || 'Rigged Character',
      sourceFormat: params.sourceFormat as 'glb' | 'gltf' | 'fbx',
      primaryFileName: params.primaryFileName.slice(0, 180) || 'character.glb',
      boneCount: Math.max(1, Math.min(500, Math.round(params.boneCount))),
      skinnedMeshCount: Math.max(1, Math.min(64, Math.round(params.skinnedMeshCount))),
      hasSkinWeights: true,
      textureCount: Math.max(0, Math.min(64, Math.round(params.textureCount))),
      totalBytes: params.glbBytes.byteLength,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const binPath = path.join(this.riggedCharsDir, `${safeId}.glb`);
    const tmpBin = `${binPath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmpBin, params.glbBytes);
    await fs.rename(tmpBin, binPath);

    const next = existing
      ? list.map((item) => (item.id === safeId ? record : item))
      : [record, ...list];
    await this.writeJsonArray(this.riggedCharsPath, next);
    return record;
  }

  async readRiggedCharacterBytes(
    id: string
  ): Promise<{ bytes: Buffer; meta: PersistedRiggedCharacterDoc } | null> {
    const safeId = path.basename(id).replace(/[^a-zA-Z0-9_\-]/g, '_');
    const list = await this.readJsonArray<PersistedRiggedCharacterDoc>(this.riggedCharsPath);
    const meta = list.find((item) => item.id === safeId);
    if (!meta) return null;
    try {
      const bytes = await fs.readFile(path.join(this.riggedCharsDir, `${safeId}.glb`));
      return { bytes, meta };
    } catch {
      return null;
    }
  }

  async deleteRiggedCharacter(id: string): Promise<boolean> {
    const safeId = path.basename(id).replace(/[^a-zA-Z0-9_\-]/g, '_');
    const list = await this.readJsonArray<PersistedRiggedCharacterDoc>(this.riggedCharsPath);
    const next = list.filter((item) => item.id !== safeId);
    if (next.length === list.length) return false;
    await this.writeJsonArray(this.riggedCharsPath, next);
    await fs.unlink(path.join(this.riggedCharsDir, `${safeId}.glb`)).catch(() => undefined);
    return true;
  }

  // ---- 2D Poses Library (reservation-first lifecycle) ----
  async reservePoseUpload(params: {
    reservationId?: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<StoredPoseInternal> {
    const list = await this.readJsonArray<StoredPoseInternal>(this.posesPath);
    if (params.reservationId) {
      const existing = list.find((p) => p.id === params.reservationId);
      if (existing) return existing;
    }

    const id = `pose-${crypto.randomUUID().slice(0, 10)}`;
    const ext = params.mimeType.includes('png')
      ? 'png'
      : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg';
    const objectKey = `${id}.${ext}`;
    const now = new Date().toISOString();

    const record: StoredPoseInternal = {
      id,
      objectKey,
      name: params.name.trim() || 'Untitled Pose',
      category: 'unsorted',
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      imageUrl: `/api/poses/objects/${objectKey}`,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    list.unshift(record);
    await this.writeJsonArray(this.posesPath, list);
    return record;
  }

  async commitPoseBytes(params: {
    id: string;
    bytes: Buffer;
    category: PoseCategory;
    aiSuggestedCategory?: PoseCategory;
    aiConfidenceNote?: string;
  }): Promise<PoseLibraryRecord | null> {
    await this.ensureDirs();
    const list = await this.readJsonArray<StoredPoseInternal>(this.posesPath);
    const idx = list.findIndex((p) => p.id === params.id);
    if (idx < 0) return null;

    const item = list[idx];
    const objPath = path.join(this.objectsDir, path.basename(item.objectKey));
    await fs.writeFile(objPath, params.bytes);

    item.status = 'ready';
    item.sizeBytes = params.bytes.byteLength;
    item.category = normalizePoseCategory(params.category);
    item.aiSuggestedCategory = params.aiSuggestedCategory;
    item.aiConfidenceNote = params.aiConfidenceNote;
    item.updatedAt = new Date().toISOString();
    list[idx] = item;

    await this.writeJsonArray(this.posesPath, list);
    return toPublicPose(item);
  }

  async readPoseObjectBytes(objectKey: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
    const safeKey = path.basename(objectKey);
    const list = await this.readJsonArray<StoredPoseInternal>(this.posesPath);
    const record = list.find((p) => p.objectKey === safeKey && p.status === 'ready');
    if (!record) return null;
    try {
      const bytes = await fs.readFile(path.join(this.objectsDir, safeKey));
      return { bytes, mimeType: record.mimeType };
    } catch {
      return null;
    }
  }

  async listPoses(query: {
    search?: string;
    category?: 'all' | PoseCategory;
    page?: number;
    pageSize?: number;
  }): Promise<PoseLibraryListResponse> {
    const list = await this.readJsonArray<StoredPoseInternal>(this.posesPath);
    const search = (query.search || '').trim().toLowerCase();
    const category = query.category && query.category !== 'all' ? query.category : null;
    const pageSize = Math.min(48, Math.max(4, query.pageSize || 12));

    const filtered = list
      .filter((p) => p.status === 'ready')
      .filter((p) => (!category ? true : p.category === category))
      .filter((p) => (!search ? true : p.name.toLowerCase().includes(search)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(totalPages, Math.max(1, query.page || 1));
    const start = (page - 1) * pageSize;

    return {
      items: filtered.slice(start, start + pageSize).map(toPublicPose),
      total,
      page,
      pageSize,
      totalPages,
      storageNotice:
        'Records stored in Express studio library (.rapuso-data/). Image URLs resolve cleanly within your running studio session.',
    };
  }

  async updatePoseMetadata(
    id: string,
    patch: {
      name?: string;
      category?: PoseCategory;
      aiSuggestedCategory?: PoseCategory;
      aiConfidenceNote?: string;
    }
  ): Promise<PoseLibraryRecord | null> {
    const list = await this.readJsonArray<StoredPoseInternal>(this.posesPath);
    const idx = list.findIndex((p) => p.id === id && p.status === 'ready');
    if (idx < 0) return null;

    const item = list[idx];
    if (typeof patch.name === 'string' && patch.name.trim()) {
      item.name = patch.name.trim().slice(0, 120);
    }
    if (patch.category) {
      item.category = normalizePoseCategory(patch.category);
    }
    if (patch.aiSuggestedCategory) {
      item.aiSuggestedCategory = normalizePoseCategory(patch.aiSuggestedCategory);
    }
    if (typeof patch.aiConfidenceNote === 'string') {
      item.aiConfidenceNote = patch.aiConfidenceNote;
    }
    item.updatedAt = new Date().toISOString();
    list[idx] = item;

    await this.writeJsonArray(this.posesPath, list);
    return toPublicPose(item);
  }

  async deletePose(id: string): Promise<boolean> {
    const list = await this.readJsonArray<StoredPoseInternal>(this.posesPath);
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    await this.writeJsonArray(this.posesPath, next);
    return true;
  }
}

function toPublicPose(item: StoredPoseInternal): PoseLibraryRecord {
  return {
    id: item.id,
    objectKey: item.objectKey,
    name: item.name,
    category: item.category,
    aiSuggestedCategory: item.aiSuggestedCategory,
    aiConfidenceNote: item.aiConfidenceNote,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    imageUrl: item.imageUrl,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
