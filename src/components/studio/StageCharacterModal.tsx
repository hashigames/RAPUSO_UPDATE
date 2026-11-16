import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bone,
  CheckCircle2,
  CloudUpload,
  FolderOpen,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { LanguageCode } from '../../../shared/studio';
import { detectModelFormat, type PortableCharacterManifest } from '../../../shared/characters';
import { autoClassifyTextureFolderFiles } from '../../lib/animation/loaders';
import { validateRiggedCharacterOnly } from '../../lib/firebaseCharacterUtils';

interface StageCharacterModalProps {
  open: boolean;
  lang: LanguageCode;
  onClose: () => void;
  activeCharacter: PortableCharacterManifest;
  onStageCharacterBundle: (
    primaryFile: File,
    companionFiles: File[],
    clipFiles: File[]
  ) => Promise<PortableCharacterManifest>;
  onSaveCharacterForever: () => Promise<void>;
  saveCharacterProgress: number | null;
}

export const StageCharacterModal: React.FC<StageCharacterModalProps> = ({
  open,
  lang,
  onClose,
  activeCharacter,
  onStageCharacterBundle,
  onSaveCharacterForever,
  saveCharacterProgress,
}) => {
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [clipFiles, setClipFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stagedInfo, setStagedInfo] = useState<{
    name: string;
    boneCount: number;
    skinnedMeshCount: number;
    format: string;
    textureCount: number;
  } | null>(null);
  const [savedForeverBanner, setSavedForeverBanner] = useState<string | null>(null);

  const primaryInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const folderSummary = useMemo(() => autoClassifyTextureFolderFiles(folderFiles), [folderFiles]);

  if (!open) return null;

  const activeRigCheck = validateRiggedCharacterOnly(
    activeCharacter.diagnostics,
    activeCharacter.format
  );

  const handlePrimaryPicked = async (files: File[]) => {
    if (files.length === 0) return;
    setErrorMsg(null);
    setSavedForeverBanner(null);

    // Pick primary 3D model (.fbx, .obj, .glb, .gltf) and combine any multi-selected companions + queued textures/mats folder
    const primary =
      files.find((f) => detectModelFormat(f.name) !== null) || files[0];
    const fmt = detectModelFormat(primary.name);
    if (!fmt) {
      setErrorMsg(
        `Unsupported file "${primary.name}". Upload a rigged .fbx, .glb, .gltf, or test .obj file.`
      );
      return;
    }

    const extraSelected = files.filter((f) => f !== primary);
    const mergedCompanions = dedupeFiles([...folderFiles, ...extraSelected]);

    setBusy(true);
    try {
      const staged = await onStageCharacterBundle(primary, mergedCompanions, clipFiles);
      setStagedInfo({
        name: staged.name,
        boneCount: staged.diagnostics.boneCount,
        skinnedMeshCount: staged.diagnostics.skinnedMeshCount,
        format: staged.format.toUpperCase(),
        textureCount: folderSummary.imageFiles.length + staged.textureBindings.length,
      });
    } catch (err) {
      setStagedInfo(null);
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDropBundle = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length === 0) return;

    const modelFile = dropped.find((f) => detectModelFormat(f.name) !== null);
    const nonModelFiles = dropped.filter((f) => f !== modelFile);

    if (nonModelFiles.length > 0) {
      setFolderFiles((prev) => dedupeFiles([...prev, ...nonModelFiles]));
    }
    if (modelFile) {
      await handlePrimaryPicked([modelFile, ...nonModelFiles]);
    } else if (nonModelFiles.length > 0) {
      setErrorMsg(null);
    }
  };

  const handleSaveForeverClick = async () => {
    setErrorMsg(null);
    setSavedForeverBanner(null);
    try {
      await onSaveCharacterForever();
      setSavedForeverBanner(
        lang === 'ja'
          ? 'リグ済みキャラクターを永続保存しました。'
          : 'Saved rigged character forever!'
      );
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Bring your character to the stage"
      data-testid="stage-character-modal"
    >
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void handleDropBundle(e)}
        className="relative w-full max-w-[660px] rounded-2xl border border-[#2d3659]/80 bg-[#101425] px-6 py-8 text-center shadow-[0_24px_80px_rgba(4,6,16,0.85)] sm:px-10 sm:py-10"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close character stage modal"
          data-testid="close-stage-modal-btn"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[#8f99bd] transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Centered Bone Badge matching reference image */}
        <div className="mx-auto mb-5 flex h-[68px] w-[68px] items-center justify-center rounded-xl border border-[#4a5685]/45 bg-[#2d3659] shadow-inner">
          <Bone className="h-8 w-8 text-[#c9d6f8]" strokeWidth={2.1} />
        </div>

        {/* Eyebrow */}
        <div className="font-mono-tech text-[11px] font-medium uppercase tracking-[0.22em] text-[#959ec0]">
          CHARACTER / キャラクター
        </div>

        {/* Headline */}
        <h2 className="mt-2.5 text-2xl font-semibold tracking-tight text-white sm:text-[31px]">
          {lang === 'ja' ? 'キャラクターをステージへ。' : 'Bring your character to the stage.'}
        </h2>

        {/* Subtitle matching reference image */}
        <p className="mx-auto mt-3 max-w-md text-[13.5px] leading-relaxed text-[#a8b2d1]">
          {lang === 'ja'
            ? 'リグ済みモデル（FBX / OBJ / GLB）と textures / mats フォルダ一式をアップロード。ボーン＆スキンウェイト付きリグのみ有効です。'
            : 'Upload the rigged model with its texture maps. Add the animation files you already have. RAPUSO previews those exact sources.'}
        </p>

        {/* Primary Sakura Upload CTA matching reference image */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <input
            ref={primaryInputRef}
            type="file"
            accept=".fbx,.obj,.glb,.gltf"
            multiple
            className="hidden"
            data-testid="stage-primary-file-input"
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              void handlePrimaryPicked(list);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            disabled={busy}
            onClick={() => primaryInputRef.current?.click()}
            data-testid="stage-upload-rigged-btn"
            className="inline-flex items-center justify-center gap-2.5 rounded-lg bg-[#F4B3C2] px-6 py-3 text-[14px] font-semibold text-[#101425] shadow-md transition-colors hover:bg-[#f7c5d1] disabled:opacity-50"
          >
            <Upload className="h-4 w-4" strokeWidth={2.2} />
            <span>
              {busy
                ? lang === 'ja'
                  ? '検証・読み込み中…'
                  : 'Validating & staging…'
                : lang === 'ja'
                  ? 'リグ済みキャラクターをアップロード'
                  : 'Upload rigged character'}
            </span>
          </button>

          {/* Secondary action row: Textures / Mats folder all at once + Optional animation clips */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <input
              ref={folderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              className="hidden"
              data-testid="stage-textures-folder-input"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) {
                  setFolderFiles((prev) => dedupeFiles([...prev, ...files]));
                  setErrorMsg(null);
                }
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              data-testid="stage-select-folder-btn"
              className="inline-flex items-center gap-1.5 rounded-md border border-[#3a456e] bg-[#1a2038] px-3 py-1.5 text-xs font-medium text-[#d5ddf5] hover:border-[#F4B3C2]/60 hover:text-white"
            >
              <FolderOpen className="h-3.5 w-3.5 text-[#F4B3C2]" />
              <span>
                {lang === 'ja'
                  ? 'textures / mats フォルダを一括選択'
                  : 'Upload textures / mats folder (all at once)'}
              </span>
            </button>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#3a456e] bg-[#1a2038] px-3 py-1.5 text-xs font-medium text-[#d5ddf5] hover:border-[#7ee0c8]/60 hover:text-white">
              <Sparkles className="h-3.5 w-3.5 text-[#7ee0c8]" />
              <span>
                {lang === 'ja' ? 'アニメーション追加 (.fbx/.glb)' : 'Add animation clips'}
              </span>
              <input
                type="file"
                accept=".fbx,.glb,.gltf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) setClipFiles((prev) => dedupeFiles([...prev, ...files]));
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {/* Queued folder / clips readout */}
          {(folderFiles.length > 0 || clipFiles.length > 0) && (
            <div
              data-testid="stage-queued-folder-badge"
              className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-[#323d63] bg-[#161c32] px-3 py-1.5 text-[11px] text-[#b9c3e3]"
            >
              {folderFiles.length > 0 && (
                <span>
                  {folderSummary.imageFiles.length} texture map(s) &{' '}
                  {folderSummary.materialCompanionFiles.length} material/bin companion(s) queued
                </span>
              )}
              {clipFiles.length > 0 && <span>· {clipFiles.length} clip file(s) queued</span>}
              <button
                type="button"
                onClick={() => {
                  setFolderFiles([]);
                  setClipFiles([]);
                }}
                className="ml-1 text-[#F4B3C2] hover:underline"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Format & Limit Subtext matching reference image */}
        <div className="mt-5 font-mono-tech text-[11px] tracking-wide text-[#8892b6]">
          FBX · OBJ · GLB · glTF / 128 MB per file · 200 MB per bundle · Rigged characters only
        </div>

        {/* Strict Rigged-Only Rejection Alert */}
        {errorMsg && (
          <div
            data-testid="rig-validation-error"
            className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-400/45 bg-red-950/55 px-4 py-3 text-left text-xs text-red-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div>
              <div className="font-semibold text-red-200">Only rigged characters are valid</div>
              <div className="mt-0.5 leading-relaxed text-red-100/90">{errorMsg}</div>
            </div>
          </div>
        )}

        {/* Staged Rigged Character Confirmation + Persistent Firebase Forever Save */}
        {(stagedInfo || (!activeCharacter.isBuiltInDemo && activeRigCheck.valid)) && (
          <div
            data-testid="rig-staged-success"
            className="mt-5 rounded-xl border border-[#7ee0c8]/35 bg-[#12262e]/70 p-4 text-left"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#8fead2]">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {stagedInfo
                    ? `Staged "${stagedInfo.name}" (${stagedInfo.format} · ${stagedInfo.boneCount} bones · ${stagedInfo.skinnedMeshCount} skinned mesh)`
                    : `Active Stage Character: "${activeCharacter.name}" (${activeCharacter.diagnostics.boneCount} bones)`}
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/20"
              >
                Open Stage
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
              <div className="text-[11px] text-[#b8c4e0]">
                {lang === 'ja'
                  ? 'このリグ済みキャラクターをスタジオライブラリに永続保存します。'
                  : 'Save this rigged character permanently to your studio library.'}
              </div>

              <button
                type="button"
                disabled={saveCharacterProgress !== null}
                onClick={() => void handleSaveForeverClick()}
                data-testid="modal-save-character-btn"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#7ee0c8] px-3.5 py-1.5 text-xs font-semibold text-[#0D131F] hover:bg-[#9be9d6] disabled:opacity-50"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                <span>
                  {saveCharacterProgress !== null
                    ? `Saving ${saveCharacterProgress}%…`
                    : 'Save Character Forever'}
                </span>
              </button>
            </div>

            {savedForeverBanner && (
              <div className="mt-2 font-mono-tech text-[11px] text-[#8fead2]">
                {savedForeverBanner}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

function dedupeFiles(list: File[]): File[] {
  const seen = new Map<string, File>();
  for (const f of list) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    seen.set(`${rel}:${f.size}`, f);
  }
  return Array.from(seen.values());
}
