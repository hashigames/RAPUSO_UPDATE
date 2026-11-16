import React, { useState } from 'react';
import {
  Bone,
  Camera,
  CloudUpload,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  PackagePlus,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import type {
  CameraPreset,
  EnvironmentBackground,
  LanguageCode,
  MaterialAppearanceSettings,
  MaterialMode,
  PropAttachment,
} from '../../../shared/studio';
import type { PortableCharacterManifest } from '../../../shared/characters';
import type { RasterOutputRecord, RasterRenderSettings } from '../../../shared/pose-raster';
import type { StudioStrings } from '../../lib/i18n';
import type { MotionDirectionResult } from '../../../server/ai';
import type { PersistedRiggedCharacterDoc } from '../../lib/api';
import { validateRiggedCharacterOnly } from '../../lib/firebaseCharacterUtils';
import { InspectorShaderTab } from './InspectorShaderTab';

interface AnimationInspectorProps {
  lang: LanguageCode;
  strings: StudioStrings;
  activeCharacter: PortableCharacterManifest;
  onOpenStageCharacterModal: () => void;
  savedRiggedCharacters: PersistedRiggedCharacterDoc[];
  saveCharacterProgress: number | null;
  saveCharacterError: string | null;
  onSaveCharacterForever: () => Promise<void>;
  onLoadSavedCharacter: (docItem: PersistedRiggedCharacterDoc) => Promise<void>;
  onDeleteSavedCharacter: (charId: string) => Promise<void>;
  material: MaterialAppearanceSettings;
  onChangeMaterial: (patch: Partial<MaterialAppearanceSettings>) => void;
  onFrameCamera: (preset: CameraPreset) => void;
  boneNames: string[];
  propsList: PropAttachment[];
  onAddProp: (kind: 'blade' | 'mic' | 'block') => void;
  onUpdateProp: (id: string, patch: Partial<PropAttachment>) => void;
  onRemoveProp: (id: string) => void;
  environmentBg: EnvironmentBackground | null;
  onUploadEnvironmentImage: (file: File) => void;
  onClearEnvironment: () => void;
  onRunAiDirection: (prompt: string) => Promise<MotionDirectionResult>;
  onApplyDirectedSequence: (res: MotionDirectionResult) => void;
  renderDurationSec: number;
  onChangeRenderDuration: (sec: number) => void;
  renderProgress: number | null;
  renderNote: string | null;
  onRecordVideo: (fps: number) => Promise<void>;
  onExportFramesZip: (fps: number) => Promise<void>;
  onCancelRender: () => void;
  rasterSettings: RasterRenderSettings;
  onChangeRasterSettings: (patch: Partial<RasterRenderSettings>) => void;
  onCaptureRasterCurrentView: () => Promise<void>;
  rasterBusy: boolean;
  latestRaster: RasterOutputRecord | null;
  onOpenRasterStudio: () => void;
}

export const AnimationInspector: React.FC<AnimationInspectorProps> = ({
  lang,
  strings,
  activeCharacter,
  onOpenStageCharacterModal,
  savedRiggedCharacters,
  saveCharacterProgress,
  saveCharacterError,
  onSaveCharacterForever,
  onLoadSavedCharacter,
  onDeleteSavedCharacter,
  material,
  onChangeMaterial,
  onFrameCamera,
  boneNames,
  propsList,
  onAddProp,
  onUpdateProp,
  onRemoveProp,
  environmentBg,
  onUploadEnvironmentImage,
  onClearEnvironment,
  onRunAiDirection,
  onApplyDirectedSequence,
  renderDurationSec,
  onChangeRenderDuration,
  renderProgress,
  renderNote,
  onRecordVideo,
  onExportFramesZip,
  onCancelRender,
  rasterSettings,
  onChangeRasterSettings,
  onCaptureRasterCurrentView,
  rasterBusy,
  latestRaster,
  onOpenRasterStudio,
}) => {
  const [inspectorTab, setInspectorTab] = useState<'general' | 'shader'>('general');
  const [prompt, setPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<MotionDirectionResult | null>(null);
  const [fps, setFps] = useState(24);
  const [loadingCharId, setLoadingCharId] = useState<string | null>(null);

  const rigValidity = validateRiggedCharacterOnly(
    activeCharacter.diagnostics,
    activeCharacter.format
  );

  const handleDirect = async () => {
    if (!prompt.trim()) return;
    setAiBusy(true);
    try {
      const res = await onRunAiDirection(prompt);
      setAiResult(res);
      if (res.supported && res.sequence.length > 0) {
        onApplyDirectedSequence(res);
      }
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col text-xs">
      {/* Animation Inspector Sub-Tabs */}
      <div className="grid grid-cols-2 border-b border-white/10 bg-[var(--surface-1)]" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'general'}
          data-testid="inspector-tab-general"
          onClick={() => setInspectorTab('general')}
          className={`border-b-2 py-2 text-[11px] font-medium transition-colors ${
            inspectorTab === 'general'
              ? 'border-[var(--accent-sakura)] text-[var(--accent-sakura-strong)] bg-[var(--surface-2)]/50'
              : 'border-transparent text-[var(--text-secondary)] hover:text-white'
          }`}
        >
          {lang === 'ja' ? 'インスペクター' : 'Inspector'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={inspectorTab === 'shader'}
          data-testid="inspector-tab-shader"
          onClick={() => setInspectorTab('shader')}
          className={`border-b-2 py-2 text-[11px] font-medium transition-colors ${
            inspectorTab === 'shader'
              ? 'border-[var(--accent-sakura)] text-[var(--accent-sakura-strong)] bg-[var(--surface-2)]/50'
              : 'border-transparent text-[var(--text-secondary)] hover:text-white'
          }`}
        >
          {lang === 'ja' ? 'シェーダー' : 'Shader'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {inspectorTab === 'shader' ? (
          <InspectorShaderTab
            lang={lang}
            rasterSettings={rasterSettings}
            onChangeRasterSettings={onChangeRasterSettings}
            viewportToonEnabled={material.mode === 'toon'}
            onToggleViewportToon={(enabled) =>
              onChangeMaterial({ mode: enabled ? 'toon' : 'original' })
            }
            onCaptureCurrentView={onCaptureRasterCurrentView}
            rasterBusy={rasterBusy}
            latestRaster={latestRaster}
            onOpenRasterStudio={onOpenRasterStudio}
          />
        ) : (
          <>
            {/* Stage Rigged Character & Save Forever (Firebase) */}
            <div
              data-testid="inspector-stage-firebase"
              className="rounded border border-[#343f66] bg-[#121628] p-2.5 space-y-2.5"
            >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-white">
            <Bone className="h-3.5 w-3.5 text-[#F4B3C2]" />
            <span>{lang === 'ja' ? 'キャラクター読込・保存' : 'Character Stage & Library'}</span>
          </div>
          <span
            className={`rounded px-1.5 py-0.5 font-mono-tech text-[10px] ${
              rigValidity.valid
                ? 'bg-[var(--accent-mint)]/15 text-[var(--accent-mint)]'
                : 'bg-red-500/15 text-red-300'
            }`}
          >
            {rigValidity.valid
              ? `${activeCharacter.diagnostics.boneCount} bones`
              : 'Unrigged'}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenStageCharacterModal}
          data-testid="inspector-open-stage-btn"
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[#F4B3C2] px-3 py-2 text-[11px] font-semibold text-[#101425] hover:bg-[#f7c5d1]"
        >
          <Upload className="h-3.5 w-3.5" />
          <span>
            {lang === 'ja'
              ? 'リグ済みキャラ / texturesフォルダ読込'
              : 'Upload Rigged Character + Folder'}
          </span>
        </button>

        <div className="text-[10px] leading-snug text-[#9ba6ca]">
          Accepts <span className="text-white">.fbx · .obj · .glb</span> + full{' '}
          <span className="text-white">textures / mats</span> folder. Only rigged meshes with bones & skin weights are valid.
        </div>

        <div className="border-t border-white/10 pt-2 space-y-2">
          <button
            type="button"
            disabled={!rigValidity.valid || saveCharacterProgress !== null}
            onClick={() => void onSaveCharacterForever()}
            data-testid="save-character-forever-btn"
            className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-[var(--accent-mint)]/60 bg-[var(--accent-mint)]/20 py-1.5 text-[11px] font-semibold text-[#98f0d8] hover:bg-[var(--accent-mint)]/30 disabled:opacity-40"
          >
            <CloudUpload className="h-3.5 w-3.5" />
            <span>
              {saveCharacterProgress !== null
                ? `Saving Forever (${saveCharacterProgress}%)…`
                : lang === 'ja'
                  ? 'キャラクターを永続保存 (Save Forever)'
                  : 'Save Rigged Character Forever'}
            </span>
          </button>

          {saveCharacterError && (
            <div
              data-testid="save-character-error-msg"
              className="rounded border border-red-400/40 bg-red-950/50 p-1.5 text-[10px] text-red-200"
            >
              {saveCharacterError}
            </div>
          )}

          <div className="space-y-1">
            <div className="font-mono-tech text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Saved Forever ({savedRiggedCharacters.length})
            </div>
            {savedRiggedCharacters.length === 0 ? (
              <div className="rounded border border-white/5 bg-[var(--surface-0)] px-2 py-1.5 text-[10px] text-[var(--text-muted)]">
                No rigged characters saved yet.
              </div>
            ) : (
              <div className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
                {savedRiggedCharacters.map((item) => (
                  <div
                    key={item.id}
                    data-testid={`saved-char-row-${item.id}`}
                    className="flex items-center justify-between gap-1.5 rounded border border-white/10 bg-[var(--surface-0)] px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-[11px] text-white">
                        {item.name}
                      </div>
                      <div className="font-mono-tech text-[9px] text-[var(--text-muted)]">
                        {item.sourceFormat.toUpperCase()} · {item.boneCount} bones ·{' '}
                        {(item.totalBytes / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={loadingCharId === item.id}
                        onClick={async () => {
                          setLoadingCharId(item.id);
                          try {
                            await onLoadSavedCharacter(item);
                          } finally {
                            setLoadingCharId(null);
                          }
                        }}
                        title="Load to Stage"
                        className="inline-flex items-center gap-1 rounded bg-[var(--accent-sakura)]/20 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/35"
                      >
                        <Download className="h-2.5 w-2.5" />
                        {loadingCharId === item.id ? '…' : 'Load'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteSavedCharacter(item.id)}
                        title="Delete saved character"
                        aria-label={`Delete ${item.name}`}
                        className="rounded p-1 text-[var(--text-muted)] hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Motion Director */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent-sakura)]" />
          <span>{strings.directMotionLabel}</span>
        </div>
        <textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={strings.directMotionPlaceholder}
          className="w-full rounded border border-white/10 bg-[var(--surface-1)] p-2 text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-sakura)] focus:outline-none"
        />
        <button
          type="button"
          disabled={aiBusy || !prompt.trim()}
          onClick={() => void handleDirect()}
          className="w-full rounded bg-[var(--accent-sakura)]/20 border border-[var(--accent-sakura)]/50 py-1.5 text-[11px] font-medium text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/30 disabled:opacity-40"
        >
          {aiBusy ? 'Planning…' : strings.directMotionRun}
        </button>

        {aiResult && (
          <div
            className={`rounded border p-2 text-[11px] space-y-1 ${
              aiResult.supported
                ? 'border-[var(--accent-mint)]/40 bg-[var(--accent-mint)]/10 text-[var(--text-primary)]'
                : 'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]'
            }`}
          >
            <div>{aiResult.explanation}</div>
            <div className="font-mono-tech text-[10px] text-[var(--text-muted)]">
              Model: {aiResult.modelUsed} · Clips mapped: {aiResult.sequence.length}
            </div>
          </div>
        )}
      </div>

      {/* Camera & Material Display */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <Camera className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
          <span>{lang === 'ja' ? 'カメラ・マテリアル表示' : 'Camera & Materials'}</span>
        </div>

        <div className="grid grid-cols-4 gap-1">
          {(['perspective', 'front', 'side', 'back'] as CameraPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onFrameCamera(p)}
              className="rounded border border-white/10 bg-[var(--surface-2)] py-1 text-[10px] capitalize hover:border-[var(--accent-mint)]/60"
            >
              {p === 'perspective' ? '3D' : p}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-1 pt-1">
          {(['original', 'toon', 'clay', 'wire'] as MaterialMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChangeMaterial({ mode: m })}
              className={`rounded border py-1 text-[10px] capitalize ${
                material.mode === m
                  ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/20 text-[var(--accent-sakura-strong)] font-semibold'
                  : 'border-white/10 bg-[var(--surface-2)] text-[var(--text-secondary)]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px]">
          <label className="flex items-center gap-1.5 cursor-pointer text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={material.showSkeleton}
              onChange={(e) => onChangeMaterial({ showSkeleton: e.target.checked })}
              className="accent-[var(--accent-mint)]"
            />
            Show Skeleton Helper
          </label>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--text-muted)]">Tint</span>
            <input
              type="color"
              value={material.tintHex}
              onChange={(e) => onChangeMaterial({ tintHex: e.target.value })}
              className="h-5 w-7 cursor-pointer rounded border border-white/15 bg-transparent"
            />
          </div>
        </div>
      </div>

      {/* Environment Backdrop & Bone-Attached Props */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
            <Layers className="h-3.5 w-3.5 text-[var(--accent-sakura)]" />
            <span>{lang === 'ja' ? '背景・ボーン連動プロップ' : 'Background & Props'}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="flex-1 inline-flex cursor-pointer items-center justify-center gap-1 rounded border border-white/15 bg-[var(--surface-2)] py-1 text-[11px] hover:border-white/30">
            <ImageIcon className="h-3 w-3 text-[var(--accent-sakura)]" />
            <span>{environmentBg ? 'Change 2D Backdrop' : 'Add 2D Backdrop'}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadEnvironmentImage(f);
                e.target.value = '';
              }}
            />
          </label>
          {environmentBg && (
            <button
              type="button"
              onClick={onClearEnvironment}
              className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--text-muted)] hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-[10px] text-[var(--text-muted)]">
          2D backdrop images provide visual staging only, not full 3D environment geometry.
        </div>

        <div className="grid grid-cols-3 gap-1 pt-1">
          <button
            type="button"
            onClick={() => onAddProp('blade')}
            className="inline-flex items-center justify-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] py-1 text-[10px] hover:border-[var(--accent-sakura)]/50"
          >
            <PackagePlus className="h-3 w-3" /> Blade
          </button>
          <button
            type="button"
            onClick={() => onAddProp('mic')}
            className="inline-flex items-center justify-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] py-1 text-[10px] hover:border-[var(--accent-sakura)]/50"
          >
            <PackagePlus className="h-3 w-3" /> Mic
          </button>
          <button
            type="button"
            onClick={() => onAddProp('block')}
            className="inline-flex items-center justify-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] py-1 text-[10px] hover:border-[var(--accent-sakura)]/50"
          >
            <PackagePlus className="h-3 w-3" /> Cube
          </button>
        </div>

        {propsList.map((prop) => (
          <div key={prop.id} className="rounded border border-white/10 bg-[var(--surface-1)] p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--text-primary)]">{prop.name}</span>
              <button
                type="button"
                onClick={() => onRemoveProp(prop.id)}
                className="text-[var(--text-muted)] hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <select
              value={prop.attachedBoneName || ''}
              onChange={(e) => onUpdateProp(prop.id, { attachedBoneName: e.target.value || null })}
              className="w-full rounded border border-white/10 bg-[var(--surface-0)] px-1.5 py-0.5 text-[10px]"
            >
              <option value="">World Static (Unbound)</option>
              {boneNames.map((b) => (
                <option key={b} value={b}>
                  Attach Bone: {b}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-3 gap-1 font-mono-tech text-[10px]">
              {(['x', 'y', 'z'] as const).map((ax) => (
                <input
                  key={ax}
                  type="number"
                  step={0.05}
                  value={Number(prop.transform.position[ax].toFixed(2))}
                  onChange={(e) =>
                    onUpdateProp(prop.id, {
                      transform: {
                        ...prop.transform,
                        position: {
                          ...prop.transform.position,
                          [ax]: Number(e.target.value) || 0,
                        },
                      },
                    })
                  }
                  className="rounded border border-white/10 bg-[var(--surface-0)] px-1 py-0.5"
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Render Video & PNG Frames ZIP */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <Video className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
          <span>{lang === 'ja' ? 'シーン動画・連番ZIP出力' : 'Scene Render & Export'}</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[10px] text-[var(--text-secondary)]">
            {strings.recordDurationLabel}
            <input
              type="number"
              min={1}
              max={600}
              value={renderDurationSec}
              onChange={(e) => onChangeRenderDuration(Number(e.target.value) || 1)}
              className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-1)] px-2 py-1 font-mono-tech text-[11px]"
            />
          </label>
          <label className="text-[10px] text-[var(--text-secondary)]">
            Target FPS
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-1)] px-2 py-1 font-mono-tech text-[11px]"
            >
              <option value={12}>12 fps (Anime 2s)</option>
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
            </select>
          </label>
        </div>

        {renderProgress !== null ? (
          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded bg-[var(--surface-2)]">
              <div
                className="h-full bg-[var(--accent-mint)] transition-all"
                style={{ width: `${renderProgress}%` }}
              />
            </div>
            <button
              type="button"
              onClick={onCancelRender}
              className="w-full rounded border border-red-400/50 bg-red-500/20 py-1 text-[11px] text-red-200"
            >
              Cancel Render ({renderProgress}%)
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => void onRecordVideo(fps)}
              className="inline-flex items-center justify-center gap-1 rounded bg-[var(--accent-sakura)] px-2 py-1.5 text-[11px] font-semibold text-[#0D0F18] hover:bg-[var(--accent-sakura-strong)]"
              data-testid="record-video-btn"
            >
              <Film className="h-3.5 w-3.5" />
              Video (1–600s)
            </button>
            <button
              type="button"
              onClick={() => void onExportFramesZip(fps)}
              className="inline-flex items-center justify-center gap-1 rounded border border-white/15 bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] hover:border-[var(--accent-mint)]/50"
              data-testid="export-frames-zip-btn"
            >
              PNG Frames ZIP
            </button>
          </div>
        )}

        <div className="text-[10px] text-[var(--text-muted)]">
          Uses native browser MediaRecorder (MP4 if supported by browser codec, otherwise WebM—never mislabeled). Frame rate is a target subject to device resources.
        </div>
        {renderNote && (
          <div className="font-mono-tech text-[10px] text-[var(--accent-mint)]">{renderNote}</div>
        )}
      </div>
          </>
        )}
      </div>
    </div>
  );
};
