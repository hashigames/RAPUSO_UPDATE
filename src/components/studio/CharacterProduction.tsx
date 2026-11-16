import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Film,
  Layers,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  CharacterClipSetting,
  FlipYMode,
  NormalYConvention,
  PbrTextureSlotBinding,
  PortableCharacterManifest,
  TextureMapChannel,
  UvChannelMode,
} from '../../../shared/characters';
import type { LanguageCode } from '../../../shared/studio';
import type { StudioStrings } from '../../lib/i18n';

interface CharacterProductionProps {
  lang: LanguageCode;
  strings: StudioStrings;
  activeCharacter: PortableCharacterManifest;
  savedServerCharacters: PortableCharacterManifest[];
  localCharacters: PortableCharacterManifest[];
  activeClipName: string | null;
  onUploadCharacterBundle: (primaryFile: File, companions: File[]) => Promise<void>;
  onUploadAnimationClips: (files: File[]) => Promise<void>;
  onLoadDemoCharacter: () => void;
  onSelectClip: (clipName: string) => void;
  onUpdateClipSetting: (clipId: string, patch: Partial<CharacterClipSetting>) => void;
  onAddTextureBinding: (binding: PbrTextureSlotBinding) => Promise<void>;
  onClearTextureBindings: () => Promise<void>;
  onSaveCharacterToServer: () => Promise<void>;
  onSaveCharacterLocally: () => void;
  onLoadCharacterManifest: (manifest: PortableCharacterManifest) => Promise<void>;
  onDeleteServerCharacter: (recordId: string) => Promise<void>;
  onRefreshServerCharacters: () => Promise<void>;
  onExportGlb: () => Promise<void>;
  onExportBvh: () => void;
}

export const CharacterProduction: React.FC<CharacterProductionProps> = ({
  lang,
  strings,
  activeCharacter,
  savedServerCharacters,
  activeClipName,
  onUploadCharacterBundle,
  onUploadAnimationClips,
  onLoadDemoCharacter,
  onSelectClip,
  onUpdateClipSetting,
  onAddTextureBinding,
  onClearTextureBindings,
  onSaveCharacterToServer,
  onSaveCharacterLocally,
  onLoadCharacterManifest,
  onDeleteServerCharacter,
  onRefreshServerCharacters,
  onExportGlb,
  onExportBvh,
}) => {
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [companionFiles, setCompanionFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // PBR texture mapper form state
  const [texChannel, setTexChannel] = useState<TextureMapChannel>('baseColor');
  const [targetSlot, setTargetSlot] = useState<string>('__auto__');
  const [uvChannel, setUvChannel] = useState<UvChannelMode>('auto');
  const [flipY, setFlipY] = useState<FlipYMode>('auto');
  const [normalY, setNormalY] = useState<NormalYConvention>('opengl');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const diag = activeCharacter.diagnostics;

  const handleUploadBundleSubmit = async () => {
    if (!primaryFile) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await onUploadCharacterBundle(primaryFile, companionFiles);
      setPrimaryFile(null);
      setCompanionFiles([]);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTextureFilePick = async (file: File) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await onAddTextureBinding({
        id: `tex-${Date.now()}`,
        channel: texChannel,
        fileName: file.name,
        dataUrlOrAssetId: dataUrl,
        targetMaterialSlot: targetSlot,
        uvChannel,
        flipY,
        normalY,
      });
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-3 text-xs">
      {/* Header status & Upload */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono-tech text-[10px] uppercase tracking-wider text-[var(--accent-sakura)]">
              {lang === 'ja' ? '制作リグ / モデル情報' : 'Active Character Rig'}
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{activeCharacter.name}</h3>
            <div className="mt-0.5 font-mono-tech text-[11px] text-[var(--text-secondary)]">
              {activeCharacter.format.toUpperCase()} ·{' '}
              {activeCharacter.isBuiltInDemo ? 'Bundled Demo Rig' : 'Uploaded Bundle'} ·{' '}
              {activeCharacter.savedRecordId
                ? `Saved ID: ${activeCharacter.savedRecordId}`
                : activeCharacter.persistenceScope === 'local_browser'
                ? 'Local Draft Only'
                : 'Unsaved Session'}
            </div>
          </div>

          <button
            type="button"
            onClick={onLoadDemoCharacter}
            className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-white"
          >
            {lang === 'ja' ? 'デモ体型へ戻す' : 'Reset to Demo'}
          </button>
        </div>

        {/* Rig Diagnostics */}
        <div className="grid grid-cols-3 gap-1.5 rounded border border-white/10 bg-[var(--surface-1)] p-2 font-mono-tech text-[11px]">
          <div>
            <span className="text-[var(--text-muted)]">Bones: </span>
            <span className={diag.boneCount > 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-amber)]'}>
              {diag.boneCount}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Skinned: </span>
            <span className={diag.hasSkinWeights ? 'text-[var(--accent-green)]' : 'text-[var(--accent-amber)]'}>
              {diag.skinnedMeshCount}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Clips: </span>
            <span>{activeCharacter.clipSettings.length}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Tris: </span>
            <span>{diag.triangleCount.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Slots: </span>
            <span>{diag.materialSlotNames.length}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Morphs: </span>
            <span>{diag.morphTargetNames.length}</span>
          </div>
        </div>

        {diag.warnings.length > 0 && (
          <div className="space-y-1 rounded border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 p-2 text-[11px] text-[var(--accent-amber)]">
            {diag.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Upload Model & Companion Bundle */}
        <div className="space-y-2 border-t border-white/10 pt-2.5">
          <div className="font-medium text-[var(--text-primary)]">
            {strings.uploadCharacterBtn} (GLB / glTF / FBX / Static OBJ)
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">
            Limits: 128 MiB / file, 200 MiB / bundle. Uploaded rigs retain exact clips without auto-generated motion.
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <label className="flex cursor-pointer items-center justify-between rounded border border-dashed border-white/20 bg-[var(--surface-1)] px-2.5 py-2 hover:border-[var(--accent-sakura)]/60">
              <span className="truncate text-[11px] text-[var(--text-secondary)]">
                {primaryFile ? primaryFile.name : '1. Choose Model (.glb, .fbx, .gltf, .obj)'}
              </span>
              <Upload className="h-3.5 w-3.5 text-[var(--accent-sakura)] shrink-0" />
              <input
                type="file"
                accept=".glb,.gltf,.fbx,.obj"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setPrimaryFile(f);
                  e.target.value = '';
                }}
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded border border-dashed border-white/15 bg-[var(--surface-1)] px-2.5 py-1.5 hover:border-white/30">
              <span className="truncate text-[11px] text-[var(--text-muted)]">
                {companionFiles.length > 0
                  ? `${companionFiles.length} companion files selected`
                  : '2. Optional companion textures / .bin / .mtl'}
              </span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  setCompanionFiles(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
            </label>

            {primaryFile && (
              <button
                type="button"
                disabled={busy}
                onClick={handleUploadBundleSubmit}
                className="rounded bg-[var(--accent-sakura)] px-3 py-1.5 text-xs font-semibold text-[#0D0F18] hover:bg-[var(--accent-sakura-strong)] disabled:opacity-50"
              >
                {busy ? 'Loading Bundle…' : 'Load Selected Character'}
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="rounded border border-red-400/50 bg-red-500/10 p-2 text-[11px] text-red-200">
            {errorMsg}
          </div>
        )}
      </div>

      {/* PBR Texture Assignment with UV & Material-Slot Safety */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
            <Layers className="h-3.5 w-3.5 text-[var(--accent-sakura)]" />
            <span>{lang === 'ja' ? 'PBRテクスチャ設定 (UV/スロット保護)' : 'PBR Texture Mapping'}</span>
          </div>
          {activeCharacter.textureBindings.length > 0 && (
            <button
              type="button"
              onClick={() => void onClearTextureBindings()}
              className="text-[11px] text-[var(--accent-sakura)] hover:underline"
            >
              Restore Originals
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <select
            value={texChannel}
            onChange={(e) => setTexChannel(e.target.value as TextureMapChannel)}
            aria-label="Texture Channel"
            className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px]"
          >
            <option value="baseColor">Base Color (sRGB)</option>
            <option value="normal">Normal Map</option>
            <option value="roughness">Roughness</option>
            <option value="metallic">Metallic</option>
          </select>

          <select
            value={targetSlot}
            onChange={(e) => setTargetSlot(e.target.value)}
            aria-label="Target Material Slot"
            className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px]"
          >
            <option value="__auto__">Auto-match Slot</option>
            <option value="__all_atlas__">All Materials (Atlas Mode)</option>
            {diag.materialSlotNames.map((slot) => (
              <option key={slot} value={slot}>
                Slot: {slot}
              </option>
            ))}
          </select>

          <select
            value={uvChannel}
            onChange={(e) => setUvChannel(e.target.value as UvChannelMode)}
            aria-label="UV Channel"
            className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px]"
          >
            <option value="auto">UV: Auto Preserve</option>
            <option value="uv0">UV0</option>
            <option value="uv1">UV1</option>
          </select>

          <select
            value={flipY}
            onChange={(e) => setFlipY(e.target.value as FlipYMode)}
            aria-label="Vertical Flip"
            className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px]"
          >
            <option value="auto">FlipY: Inherit</option>
            <option value="flip">Force FlipY On</option>
            <option value="no-flip">Force No-Flip</option>
          </select>
        </div>

        {texChannel === 'normal' && (
          <select
            value={normalY}
            onChange={(e) => setNormalY(e.target.value as NormalYConvention)}
            aria-label="Normal Y Convention"
            className="w-full rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px]"
          >
            <option value="opengl">Normal-Y: OpenGL (+Y)</option>
            <option value="directx">Normal-Y: DirectX (-Y inverted)</option>
          </select>
        )}

        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded border border-white/15 bg-[var(--surface-2)] py-1.5 text-[11px] hover:border-[var(--accent-sakura)]/60">
          <Upload className="h-3.5 w-3.5 text-[var(--accent-sakura)]" />
          <span>Assign Texture Image to Slot</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleTextureFilePick(f);
              e.target.value = '';
            }}
          />
        </label>

        {activeCharacter.textureBindings.length > 0 && (
          <div className="space-y-1 text-[10px] font-mono-tech text-[var(--text-secondary)]">
            {activeCharacter.textureBindings.map((tb) => (
              <div key={tb.id} className="flex items-center justify-between rounded bg-[var(--surface-1)] px-2 py-1">
                <span className="truncate">
                  {tb.channel} · {tb.fileName} → {tb.targetMaterialSlot}
                </span>
                <span>{tb.uvChannel}/{tb.flipY}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clips Discovery & Upload */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
            <Film className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
            <span>{lang === 'ja' ? 'モーションクリップ管理' : 'Animation Clips'}</span>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-white/15 bg-[var(--surface-2)] px-2 py-1 text-[11px] hover:border-[var(--accent-mint)]/60">
            <Upload className="h-3 w-3" />
            <span>Add FBX/GLB Clip</span>
            <input
              type="file"
              accept=".fbx,.glb,.gltf"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) void onUploadAnimationClips(files);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {activeCharacter.clipSettings.length === 0 ? (
          <div className="rounded border border-white/10 bg-[var(--surface-1)] p-2 text-[11px] text-[var(--text-secondary)]">
            No animation clips on this rig. Upload FBX/GLB clips or author in Pose keyframes only mode.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {activeCharacter.clipSettings.map((clip) => (
              <div
                key={clip.id}
                className={`rounded border p-2 ${
                  activeClipName === clip.sourceName
                    ? 'border-[var(--accent-sakura)]/60 bg-[var(--accent-sakura)]/10'
                    : 'border-white/10 bg-[var(--surface-1)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={!clip.compatible}
                    onClick={() => onSelectClip(clip.sourceName)}
                    className="text-left font-medium text-[var(--text-primary)] hover:text-[var(--accent-sakura)] disabled:opacity-40"
                  >
                    {clip.label}
                  </button>
                  <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                    {clip.durationSec.toFixed(2)}s · {clip.boundTrackCount}/{clip.totalTrackCount} tracks
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                  <input
                    type="text"
                    value={clip.label}
                    onChange={(e) => onUpdateClipSetting(clip.id, { label: e.target.value })}
                    aria-label="Clip label"
                    className="flex-1 rounded border border-white/10 bg-[var(--surface-0)] px-1.5 py-0.5 text-[var(--text-primary)]"
                  />
                  <label className="flex items-center gap-1 text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={clip.loop}
                      onChange={(e) => onUpdateClipSetting(clip.id, { loop: e.target.checked })}
                    />
                    Loop
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save & Export Actions */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-3 space-y-2.5">
        <div className="font-semibold text-[var(--text-primary)]">
          {lang === 'ja' ? '保存・書き出し' : 'Persist & Export'}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => void onSaveCharacterToServer()}
            className="inline-flex items-center justify-center gap-1 rounded bg-[var(--accent-sakura)]/20 border border-[var(--accent-sakura)]/50 px-2 py-1.5 text-[11px] font-medium text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/30"
            data-testid="save-character-server-btn"
          >
            <Database className="h-3.5 w-3.5" />
            Save to Server
          </button>

          <button
            type="button"
            onClick={onSaveCharacterLocally}
            className="inline-flex items-center justify-center gap-1 rounded border border-white/15 bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] hover:border-white/30"
          >
            Save Local Draft
          </button>

          <button
            type="button"
            onClick={() => void onExportGlb()}
            className="inline-flex items-center justify-center gap-1 rounded border border-white/15 bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] hover:border-[var(--accent-mint)]/50"
          >
            <Download className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
            Export GLB
          </button>

          <button
            type="button"
            onClick={onExportBvh}
            className="inline-flex items-center justify-center gap-1 rounded border border-white/15 bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] hover:border-[var(--accent-mint)]/50"
          >
            <Download className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
            Export BVH
          </button>
        </div>

        <div className="text-[10px] text-[var(--text-muted)]">
          Exports genuine animated GLB & skeletal BVH. Native FBX export is unsupported in this browser runtime; OBJ carries static geometry only.
        </div>

        {/* Saved Server Characters List */}
        <div className="border-t border-white/10 pt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              Saved Server Characters ({savedServerCharacters.length})
            </span>
            <button
              type="button"
              onClick={() => void onRefreshServerCharacters()}
              className="inline-flex items-center gap-1 text-[10px] text-[var(--accent-mint)] hover:underline"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>

          {savedServerCharacters.length === 0 ? (
            <div className="text-[10px] text-[var(--text-muted)]">No saved server character records yet.</div>
          ) : (
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {savedServerCharacters.map((c) => (
                <div
                  key={c.savedRecordId || c.id}
                  className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[var(--surface-1)] px-2 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => void onLoadCharacterManifest(c)}
                    className="flex items-center gap-1.5 truncate text-left text-[11px] text-[var(--text-primary)] hover:text-[var(--accent-sakura)]"
                  >
                    <CheckCircle2 className="h-3 w-3 text-[var(--accent-green)] shrink-0" />
                    <span className="truncate">{c.name}</span>
                  </button>
                  {deleteConfirmId === (c.savedRecordId || c.id) ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onDeleteServerCharacter(c.savedRecordId || c.id);
                        setDeleteConfirmId(null);
                      }}
                      className="text-[10px] font-semibold text-red-400 hover:underline shrink-0"
                    >
                      Confirm Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(c.savedRecordId || c.id)}
                      aria-label={`Remove ${c.name}`}
                      className="text-[var(--text-muted)] hover:text-red-400 shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read texture file.'));
    reader.readAsDataURL(file);
  });
}
