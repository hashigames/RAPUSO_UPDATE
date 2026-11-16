import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Download,
  Hand,
  Image as ImageIcon,
  Layers,
  Move,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { BoneRotationMap, CameraPreset, LanguageCode, NamedPose } from '../../../shared/studio';
import type {
  AnimeShadowTint,
  BackgroundHarmonyMode,
  CameraFramingPreset,
  FingerControlsState,
  HandPresetId,
  HandSide,
  IkLimbId,
  IkTargetsMap,
  InkPenStyle,
  MangaOverlayEffect,
  MannequinDriverState,
  PoseLibraryRecord,
  RasterOutputRecord,
  RasterRenderSettings,
  RasterSceneAssets,
  RasterStyleMode,
  ReferenceImageSlot,
  ReferenceSlotView,
} from '../../../shared/pose-raster';
import {
  ANIME_SHADER_PRESET_CATALOG,
  getAnimeShaderPresetDefaults,
  RASTER_RESOLUTION_OPTIONS,
  validateRasterSettings,
} from '../../../shared/pose-raster';
import type { StudioStrings } from '../../lib/i18n';
import { getHandPresetValues } from '../../lib/animation/poseIk';
import { composeRasterRecordExportDataUrl } from '../../lib/animation/raster';
import { MannequinPreview } from './MannequinPreview';
import { critiqueRasterRequest, listPoseLibrary } from '../../lib/api';
import type { RasterCritiqueResult } from '../../../server/ai';

interface PoseDrawingWorkspaceProps {
  lang: LanguageCode;
  strings: StudioStrings;
  boneNames: string[];
  hasSkinWeights: boolean;
  hasArticulatedFingers: boolean;
  selectedBoneName: string | null;
  onSelectBone: (boneName: string | null) => void;
  showGizmoRings: boolean;
  onToggleGizmoRings: (v: boolean) => void;
  boneRotations: BoneRotationMap;
  bonePositions?: BoneRotationMap;
  onSetBoneRotation: (boneName: string, euler: { x: number; y: number; z: number }) => void;
  onSetBonePosition?: (boneName: string, pos: { x: number; y: number; z: number }) => void;
  onUndoPose: () => void;
  canUndo: boolean;
  onResetPose: () => void;
  fingerControls: FingerControlsState;
  onChangeFingerControls: (next: FingerControlsState) => void;
  ikTargets: IkTargetsMap;
  onUpdateIkTarget: (limb: IkLimbId, patch: Partial<IkTargetsMap[IkLimbId]>) => void;
  onApplyIkLimb: (limb: IkLimbId) => void;
  savedPoses: NamedPose[];
  onSaveNamedPose: (name: string) => void;
  onApplyNamedPose: (pose: NamedPose) => void;
  onAddPoseKeyframe: (label: string) => void;
  driverState: MannequinDriverState;
  onUpdateDriverRotations: (rot: BoneRotationMap) => void;
  onUpdateDriverPositions: (pos: BoneRotationMap) => void;
  onUpdateDriverFingers: (fc: FingerControlsState) => void;
  onCopyMannequinPose: () => void;
  onToggleMannequinLiveFollow: (enabled: boolean) => void;
  referenceSlots: ReferenceImageSlot[];
  onUploadReferenceSlotImage: (view: ReferenceSlotView, file: File) => void;
  onDetectReferenceSlot: (view: ReferenceSlotView, subjectIdx?: number) => Promise<void>;
  onUpdateReferenceLandmark: (view: ReferenceSlotView, landmarkIdx: number, x: number, y: number) => void;
  onConfirmSamePose: (view: ReferenceSlotView, confirmed: boolean) => void;
  onApplyReferenceSlotsPose: (primaryView: ReferenceSlotView) => void;
  onApplyMultiViewToMannequin: (subjectIdx?: number) => Promise<void>;
  multiViewBusy: boolean;
  multiViewNote: string | null;
  selectedLibraryPose: PoseLibraryRecord | null;
  onSelectLibraryPose: (pose: PoseLibraryRecord) => void;
  onChangePoseFromLibrary: (pose: PoseLibraryRecord) => Promise<void>;
  rasterSettings: RasterRenderSettings;
  onChangeRasterSettings: (patch: Partial<RasterRenderSettings>) => void;
  onResetRasterCamera: () => void;
  rasterSceneAssets: RasterSceneAssets;
  onAddRasterSceneImages: (
    kind: keyof RasterSceneAssets,
    files: FileList | File[]
  ) => void;
  onRemoveRasterSceneImage: (kind: keyof RasterSceneAssets, id: string) => void;
  onClearRasterSceneCategory: (kind: keyof RasterSceneAssets) => void;
  rasterOutputs: RasterOutputRecord[];
  activeRasterId: string | null;
  onSelectRasterId: (id: string) => void;
  onUpdateRasterPlacement: (
    id: string,
    patch: { foregroundOffsetX?: number; foregroundOffsetY?: number; foregroundScale?: number },
    applyToAllViews?: boolean
  ) => void;
  onRunRasterCapture: (views: CameraPreset[], overrideSettings?: RasterRenderSettings) => Promise<void>;
  onDownloadRasterZip: (record: RasterOutputRecord) => void;
  rasterBusy: boolean;
  onCancelRaster: () => void;
  stageMinimized?: boolean;
  onToggleStageMinimized?: () => void;
  requestedSubTab?: { tab: 'skeleton' | 'reference' | 'raster'; seq: number } | null;
}

export const PoseDrawingWorkspace: React.FC<PoseDrawingWorkspaceProps> = ({
  lang,
  strings,
  boneNames,
  hasSkinWeights,
  hasArticulatedFingers,
  selectedBoneName,
  onSelectBone,
  showGizmoRings,
  onToggleGizmoRings,
  boneRotations,
  bonePositions,
  onSetBoneRotation,
  onSetBonePosition,
  onUndoPose,
  canUndo,
  onResetPose,
  fingerControls,
  onChangeFingerControls,
  ikTargets,
  onUpdateIkTarget,
  onApplyIkLimb,
  savedPoses,
  onSaveNamedPose,
  onApplyNamedPose,
  onAddPoseKeyframe,
  driverState,
  onUpdateDriverRotations,
  onUpdateDriverPositions,
  onUpdateDriverFingers,
  onCopyMannequinPose,
  onToggleMannequinLiveFollow,
  referenceSlots,
  onUploadReferenceSlotImage,
  onDetectReferenceSlot,
  onUpdateReferenceLandmark,
  onConfirmSamePose,
  onApplyReferenceSlotsPose,
  onApplyMultiViewToMannequin,
  multiViewBusy,
  multiViewNote,
  selectedLibraryPose,
  onSelectLibraryPose,
  onChangePoseFromLibrary,
  rasterSettings,
  onChangeRasterSettings,
  onResetRasterCamera,
  rasterSceneAssets,
  onAddRasterSceneImages,
  onRemoveRasterSceneImage,
  onClearRasterSceneCategory,
  rasterOutputs,
  activeRasterId,
  onSelectRasterId,
  onUpdateRasterPlacement,
  onRunRasterCapture,
  onDownloadRasterZip,
  rasterBusy,
  onCancelRaster,
  stageMinimized = false,
  onToggleStageMinimized,
  requestedSubTab = null,
}) => {
  const [subTab, setSubTab] = useState<'skeleton' | 'reference' | 'raster'>(
    requestedSubTab?.tab ?? 'skeleton'
  );
  useEffect(() => {
    if (requestedSubTab) {
      setSubTab(requestedSubTab.tab);
    }
  }, [requestedSubTab]);
  const [poseNameInput, setPoseNameInput] = useState('Pose 01');
  const [handSide, setHandSide] = useState<HandSide>('left');
  const [fkMode, setFkMode] = useState<'rotate' | 'move'>('rotate');
  const [activeRefView, setActiveRefView] = useState<ReferenceSlotView>('front');
  const [subjectIdx, setSubjectIdx] = useState(0);
  const [draggingLmIdx, setDraggingLmIdx] = useState<number | null>(null);
  const [rasterGizmoVisible, setRasterGizmoVisible] = useState(true);
  const [rasterDragMode, setRasterDragMode] = useState<'xy' | 'x' | 'y' | null>(null);
  const [aiCritiqueBusy, setAiCritiqueBusy] = useState(false);
  const [aiCritiqueResult, setAiCritiqueResult] = useState<RasterCritiqueResult | null>(null);
  const [aiCritiqueError, setAiCritiqueError] = useState<string | null>(null);
  const rasterStageRef = useRef<HTMLDivElement | null>(null);
  const rasterDragRef = useRef<{
    mode: 'xy' | 'x' | 'y';
    clientX: number;
    clientY: number;
    startOx: number;
    startOy: number;
    stageW: number;
    stageH: number;
    recordId: string;
  } | null>(null);

  // Compact library picker inside Pose & Drawing
  const [pickerItems, setPickerItems] = useState<PoseLibraryRecord[]>([]);
  const [pickerPage, setPickerPage] = useState(1);
  const [pickerTotalPages, setPickerTotalPages] = useState(1);

  useEffect(() => {
    const ctrl = new AbortController();
    void listPoseLibrary({ page: pickerPage, pageSize: 6, signal: ctrl.signal })
      .then((res) => {
        if (!ctrl.signal.aborted) {
          setPickerItems(res.items);
          setPickerTotalPages(res.totalPages);
        }
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [pickerPage]);

  const currentBone = selectedBoneName || boneNames[0] || '';
  const currentRot = boneRotations[currentBone] || { x: 0, y: 0, z: 0 };
  const currentPos = bonePositions?.[currentBone] || { x: 0, y: 0, z: 0 };
  const activeSlot = referenceSlots.find((s) => s.view === activeRefView) || referenceSlots[0];
  const activeHand = fingerControls[handSide];

  const activeRaster =
    rasterOutputs.find((r) => r.id === activeRasterId) || rasterOutputs[0] || null;

  useEffect(() => {
    if (!rasterDragMode) return;
    const onMove = (ev: PointerEvent) => {
      const d = rasterDragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.clientX) / Math.max(1, d.stageW);
      const dy = (ev.clientY - d.clientY) / Math.max(1, d.stageH);
      const nextOx =
        d.mode === 'y'
          ? d.startOx
          : Math.max(-1, Math.min(1, Number((d.startOx + dx).toFixed(4))));
      const nextOy =
        d.mode === 'x'
          ? d.startOy
          : Math.max(-1, Math.min(1, Number((d.startOy + dy).toFixed(4))));
      onUpdateRasterPlacement(d.recordId, {
        foregroundOffsetX: nextOx,
        foregroundOffsetY: nextOy,
      });
    };
    const onUp = () => {
      rasterDragRef.current = null;
      setRasterDragMode(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [rasterDragMode, onUpdateRasterPlacement]);

  const startRasterDrag = (mode: 'xy' | 'x' | 'y', e: React.PointerEvent) => {
    if (!activeRaster || !rasterStageRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = rasterStageRef.current.getBoundingClientRect();
    rasterDragRef.current = {
      mode,
      clientX: e.clientX,
      clientY: e.clientY,
      startOx: activeRaster.foregroundOffsetX ?? 0,
      startOy: activeRaster.foregroundOffsetY ?? 0,
      stageW: rect.width,
      stageH: rect.height,
      recordId: activeRaster.id,
    };
    setRasterDragMode(mode);
  };

  const handleDownloadRasterLayer = async (
    rec: RasterOutputRecord,
    layerKey: 'combined' | 'line' | 'color' | 'shadow',
    label: string
  ) => {
    const url = await composeRasterRecordExportDataUrl(rec, layerKey);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapuso_${rec.view}_${label.toLowerCase().replace(/\s+/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="flex h-full flex-col text-xs">
      {/* Sub-navigation */}
      <div className="grid grid-cols-3 border-b border-white/10 bg-[var(--surface-1)]">
        {[
          { id: 'skeleton', label: lang === 'ja' ? '骨格・手指' : 'Skeleton & Hands' },
          { id: 'reference', label: lang === 'ja' ? '2D参照・マネキン' : '2D Ref & Driver' },
          { id: 'raster', label: lang === 'ja' ? '線画・作画出力' : 'Raster / Manga' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id as typeof subTab)}
            data-testid={`pose-subtab-${t.id}`}
            className={`border-b-2 py-2 text-[11px] font-medium transition-colors ${
              subTab === t.id
                ? 'border-[var(--accent-sakura)] text-[var(--accent-sakura-strong)] bg-[var(--surface-2)]/50'
                : 'border-transparent text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {subTab === 'skeleton' && (
          <>
            {/* Pose Actions */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={!canUndo}
                onClick={onUndoPose}
                className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px] disabled:opacity-40"
              >
                <Undo2 className="h-3 w-3" /> Undo
              </button>
              <button
                type="button"
                onClick={onResetPose}
                className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px]"
              >
                <RotateCcw className="h-3 w-3" /> Reset Rest
              </button>
              <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGizmoRings}
                  onChange={(e) => onToggleGizmoRings(e.target.checked)}
                  className="accent-[var(--accent-sakura)]"
                />
                Rings
              </label>
            </div>

            {!hasSkinWeights && (
              <div className="rounded border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10 p-2 text-[11px] text-[var(--accent-amber)]">
                This mesh has no skin weights; upload a skinned character to pose its joints.
              </div>
            )}

            {/* FK Joint Rotation & Node Movement */}
            <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-semibold text-[var(--text-primary)]">Bone Node Transform</span>
                <div className="flex items-center gap-1.5">
                  <div className="inline-flex rounded border border-white/15 overflow-hidden text-[10px]">
                    <button
                      type="button"
                      onClick={() => setFkMode('rotate')}
                      className={`px-2 py-0.5 font-medium ${
                        fkMode === 'rotate'
                          ? 'bg-[var(--accent-sakura)] text-[#0D0F18]'
                          : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
                      }`}
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      onClick={() => setFkMode('move')}
                      className={`px-2 py-0.5 font-medium ${
                        fkMode === 'move'
                          ? 'bg-[var(--accent-mint)] text-[#0D0F18]'
                          : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
                      }`}
                    >
                      Move Node
                    </button>
                  </div>
                  <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                    {boneNames.length}
                  </span>
                </div>
              </div>

              <select
                value={currentBone}
                onChange={(e) => onSelectBone(e.target.value)}
                aria-label="Select Bone"
                className="w-full rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1.5 text-[11px]"
                data-testid="pose-bone-select"
              >
                {boneNames.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>

              {fkMode === 'rotate'
                ? (['x', 'y', 'z'] as const).map((axis) => (
                    <label key={axis} className="block text-[11px] text-[var(--text-secondary)]">
                      <div className="flex justify-between font-mono-tech">
                        <span>Rotate {axis.toUpperCase()}</span>
                        <span>{(currentRot[axis] * (180 / Math.PI)).toFixed(0)}°</span>
                      </div>
                      <input
                        type="range"
                        min={-3.14}
                        max={3.14}
                        step={0.01}
                        value={currentRot[axis]}
                        data-testid={`bone-slider-${axis}`}
                        onChange={(e) =>
                          onSetBoneRotation(currentBone, {
                            ...currentRot,
                            [axis]: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[var(--accent-sakura)]"
                      />
                    </label>
                  ))
                : (['x', 'y', 'z'] as const).map((axis) => (
                    <label key={axis} className="block text-[11px] text-[var(--text-secondary)]">
                      <div className="flex justify-between font-mono-tech">
                        <span>Move {axis.toUpperCase()}</span>
                        <span>
                          {currentPos[axis] >= 0 ? '+' : ''}
                          {currentPos[axis].toFixed(2)} m
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-1.2}
                        max={1.2}
                        step={0.01}
                        value={currentPos[axis]}
                        data-testid={`bone-move-slider-${axis}`}
                        onChange={(e) =>
                          onSetBonePosition?.(currentBone, {
                            ...currentPos,
                            [axis]: Number(e.target.value),
                          })
                        }
                        className="w-full accent-[var(--accent-mint)]"
                      />
                    </label>
                  ))}
            </div>

            {/* Hand & Finger Controls */}
            <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--text-primary)]">
                  <Hand className="h-3.5 w-3.5 text-[var(--accent-sakura)]" />
                  {lang === 'ja' ? '手指コントロール' : 'Hand & Finger Controls'}
                </span>
                <div className="flex rounded border border-white/10 overflow-hidden text-[10px]">
                  {(['left', 'right'] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setHandSide(side)}
                      className={`px-2 py-0.5 capitalize ${
                        handSide === side ? 'bg-[var(--accent-sakura)] text-[#0D0F18] font-semibold' : 'bg-[var(--surface-2)]'
                      }`}
                    >
                      {side}
                    </button>
                  ))}
                </div>
              </div>

              {!hasArticulatedFingers ? (
                <div className="text-[11px] text-[var(--accent-amber)]">
                  No finger chains with skin weights detected on this model.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-1">
                    {(['open', 'fist', 'point', 'relaxed'] as HandPresetId[]).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          onChangeFingerControls({
                            ...fingerControls,
                            [handSide]: getHandPresetValues(preset, activeHand),
                          })
                        }
                        className="rounded border border-white/10 bg-[var(--surface-2)] py-1 text-[10px] capitalize hover:border-[var(--accent-sakura)]/50"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <label className="block text-[10px] text-[var(--text-secondary)]">
                    Curl: {activeHand.curl.toFixed(2)}
                    <input
                      type="range"
                      min={-0.2}
                      max={1.4}
                      step={0.05}
                      value={activeHand.curl}
                      onChange={(e) =>
                        onChangeFingerControls({
                          ...fingerControls,
                          [handSide]: { ...activeHand, curl: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-[var(--accent-sakura)]"
                    />
                  </label>
                  <label className="block text-[10px] text-[var(--text-secondary)]">
                    Spread: {activeHand.spread.toFixed(2)}
                    <input
                      type="range"
                      min={-0.3}
                      max={0.7}
                      step={0.04}
                      value={activeHand.spread}
                      onChange={(e) =>
                        onChangeFingerControls({
                          ...fingerControls,
                          [handSide]: { ...activeHand, spread: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-[var(--accent-sakura)]"
                    />
                  </label>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span>Axis:</span>
                    <select
                      value={activeHand.axis}
                      onChange={(e) =>
                        onChangeFingerControls({
                          ...fingerControls,
                          [handSide]: { ...activeHand, axis: e.target.value as 'x' | 'y' | 'z' },
                        })
                      }
                      className="rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-0.5"
                    >
                      <option value="z">Z</option>
                      <option value="x">X</option>
                      <option value="y">Y</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeFingerControls({
                          ...fingerControls,
                          [handSide]: { ...activeHand, sign: activeHand.sign === 1 ? -1 : 1 },
                        })
                      }
                      className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-0.5"
                    >
                      Sign: {activeHand.sign === 1 ? '+1' : '-1'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Two-Bone Hand / Foot IK Targets */}
            <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
              <div className="font-semibold text-[var(--text-primary)]">Hand / Foot Two-Bone IK</div>
              {(['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] as IkLimbId[]).map((limb) => {
                const st = ikTargets[limb];
                return (
                  <div key={limb} className="rounded border border-white/10 bg-[var(--surface-1)] p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tech text-[11px]">{limb}</span>
                      <button
                        type="button"
                        onClick={() => onApplyIkLimb(limb)}
                        className="rounded bg-[var(--accent-mint)]/20 border border-[var(--accent-mint)]/40 px-2 py-0.5 text-[10px] text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/30"
                      >
                        Solve IK
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['x', 'y', 'z'] as const).map((ax) => (
                        <input
                          key={ax}
                          type="number"
                          step={0.05}
                          value={Number(st.target[ax].toFixed(2))}
                          aria-label={`${limb} ${ax}`}
                          onChange={(e) =>
                            onUpdateIkTarget(limb, {
                              target: { ...st.target, [ax]: Number(e.target.value) || 0 },
                            })
                          }
                          className="rounded border border-white/10 bg-[var(--surface-0)] px-1.5 py-0.5 font-mono-tech text-[10px]"
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Save Pose & Keyframe */}
            <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={poseNameInput}
                  onChange={(e) => setPoseNameInput(e.target.value)}
                  className="flex-1 rounded border border-white/10 bg-[var(--surface-1)] px-2 py-1 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => onSaveNamedPose(poseNameInput)}
                  className="rounded border border-white/15 bg-[var(--surface-2)] px-2.5 py-1 text-[11px] hover:border-[var(--accent-sakura)]/60"
                >
                  Save Pose
                </button>
                <button
                  type="button"
                  onClick={() => onAddPoseKeyframe(poseNameInput)}
                  className="inline-flex items-center gap-1 rounded bg-[var(--accent-sakura)]/20 border border-[var(--accent-sakura)]/50 px-2 py-1 text-[11px] text-[var(--accent-sakura-strong)]"
                >
                  <Plus className="h-3 w-3" /> Key
                </button>
              </div>
              {savedPoses.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {savedPoses.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onApplyNamedPose(p)}
                      className="rounded border border-white/10 bg-[var(--surface-1)] px-2 py-0.5 text-[10px] hover:border-[var(--accent-mint)]/60"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {subTab === 'reference' && (
          <>
            {/* Mannequin Driver Preview */}
            <MannequinPreview
              driverState={driverState}
              strings={strings}
              onUpdateDriverRotations={onUpdateDriverRotations}
              onUpdateDriverPositions={onUpdateDriverPositions}
              onUpdateDriverFingers={onUpdateDriverFingers}
              onCopyPoseToTarget={onCopyMannequinPose}
              onToggleLiveFollow={onToggleMannequinLiveFollow}
              onApplyMultiViewToMannequin={() => onApplyMultiViewToMannequin(subjectIdx)}
              multiViewReadyCount={
                referenceSlots.filter((s) => Boolean(s.imageUrl) || s.landmarks.length > 0).length
              }
              multiViewBusy={multiViewBusy}
              multiViewNote={multiViewNote}
              stageMinimized={stageMinimized}
              onToggleStageMinimized={onToggleStageMinimized}
            />

            {/* Compact 2D Poses Library Picker + Change Pose */}
            <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--text-primary)]">
                  2D Poses Library Picker
                </span>
                <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                  Page {pickerPage}/{pickerTotalPages}
                </span>
              </div>

              {pickerItems.length === 0 ? (
                <div className="text-[11px] text-[var(--text-muted)]">
                  Library empty. Upload 2D pose references in the 2D Poses Library tab.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {pickerItems.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectLibraryPose(p)}
                      className={`overflow-hidden rounded border bg-[#090b10] text-left ${
                        selectedLibraryPose?.id === p.id
                          ? 'border-[var(--accent-sakura)] ring-1 ring-[var(--accent-sakura)]'
                          : 'border-white/10'
                      }`}
                    >
                      <img src={p.imageUrl} alt={p.name} className="h-16 w-full object-contain" />
                      <div className="truncate px-1 py-0.5 text-[10px] text-[var(--text-secondary)]">
                        {p.name}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={pickerPage <= 1}
                    onClick={() => setPickerPage((n) => Math.max(1, n - 1))}
                    className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-0.5 text-[10px] disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={pickerPage >= pickerTotalPages}
                    onClick={() => setPickerPage((n) => Math.min(pickerTotalPages, n + 1))}
                    className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-0.5 text-[10px] disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
                {selectedLibraryPose && (
                  <button
                    type="button"
                    onClick={() => void onChangePoseFromLibrary(selectedLibraryPose)}
                    className="inline-flex items-center gap-1 rounded bg-[var(--accent-sakura)] px-2.5 py-1 text-[11px] font-semibold text-[#0D0F18] hover:bg-[var(--accent-sakura-strong)]"
                    data-testid="change-pose-btn"
                  >
                    <Sparkles className="h-3 w-3" />
                    {strings.changePoseBtn}
                  </button>
                )}
              </div>
            </div>

            {/* 3 Reference View Slots (Front / Side / Back) + Editable Landmarks */}
            <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[var(--text-primary)]">
                  Multi-View Pose Reference (Max 3 Slots)
                </span>
                <div className="flex gap-1">
                  {(['front', 'side', 'back'] as ReferenceSlotView[]).map((v) => {
                    const slotObj = referenceSlots.find((s) => s.view === v);
                    const hasData = Boolean(slotObj?.imageUrl || (slotObj?.landmarks.length ?? 0) > 0);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setActiveRefView(v)}
                        data-testid={`ref-slot-tab-${v}`}
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] capitalize ${
                          activeRefView === v
                            ? 'bg-[var(--accent-sakura)] text-[#0D0F18] font-semibold'
                            : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
                        }`}
                      >
                        <span>{v === 'back' ? 'Rear' : v}</span>
                        {hasData && (
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              activeRefView === v ? 'bg-[#0D0F18]' : 'bg-[var(--accent-mint)]'
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed border-white/20 bg-[var(--surface-1)] py-1.5 text-[11px]">
                <Upload className="h-3.5 w-3.5 text-[var(--accent-sakura)]" />
                <span>Upload {activeRefView.toUpperCase()} Reference Image</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadReferenceSlotImage(activeRefView, f);
                    e.target.value = '';
                  }}
                />
              </label>

              {activeSlot.imageUrl && (
                <div className="space-y-2">
                  <div className="flex w-full items-center justify-center overflow-hidden rounded border border-white/10 bg-[#090b10] p-1">
                    <div
                      className="relative w-fit max-w-full select-none"
                      onPointerMove={(e) => {
                        if (draggingLmIdx === null) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
                        const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / Math.max(1, rect.height)));
                        onUpdateReferenceLandmark(activeRefView, draggingLmIdx, nx, ny);
                      }}
                      onPointerUp={() => setDraggingLmIdx(null)}
                      onPointerLeave={() => setDraggingLmIdx(null)}
                    >
                      <img
                        src={activeSlot.imageUrl}
                        alt={activeSlot.imageName || activeRefView}
                        className="block max-h-80 w-auto max-w-full pointer-events-none"
                      />
                      <svg
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        className="absolute inset-0 h-full w-full"
                      >
                        {activeSlot.landmarks.map((pt) => (
                          <circle
                            key={pt.index}
                            cx={pt.x}
                            cy={pt.y}
                            r={0.022}
                            fill={pt.editedManually ? '#5eead4' : '#e6a1b0'}
                            stroke="#0d0f18"
                            strokeWidth={0.005}
                            className="cursor-grab"
                            onPointerDown={(ev) => {
                              ev.stopPropagation();
                              setDraggingLmIdx(pt.index);
                            }}
                          />
                        ))}
                      </svg>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px]">Subject #</span>
                      <input
                        type="number"
                        min={1}
                        max={3}
                        value={subjectIdx + 1}
                        onChange={(e) => setSubjectIdx(Math.max(0, (Number(e.target.value) || 1) - 1))}
                        className="w-10 rounded border border-white/10 bg-[var(--surface-2)] px-1 py-0.5 text-[10px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void onDetectReferenceSlot(activeRefView, subjectIdx)}
                      className="rounded border border-white/15 bg-[var(--surface-2)] px-2.5 py-1 text-[11px] hover:border-[var(--accent-sakura)]/50"
                    >
                      Detect (MediaPipe IMAGE)
                    </button>
                    <button
                      type="button"
                      onClick={() => onApplyReferenceSlotsPose(activeRefView)}
                      className="rounded bg-[var(--accent-mint)]/20 border border-[var(--accent-mint)]/50 px-2.5 py-1 text-[11px] font-medium text-[var(--accent-mint)]"
                    >
                      Apply Landmarks
                    </button>
                  </div>

                  {activeRefView !== 'front' && (
                    <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={activeSlot.samePoseConfirmed}
                        onChange={(e) => onConfirmSamePose(activeRefView, e.target.checked)}
                      />
                      <span>Confirm same pose & aligned view before multi-view refinement</span>
                    </label>
                  )}

                  {activeSlot.statusNote && (
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {activeSlot.statusNote} · Mean visibility: {(activeSlot.confidenceMean * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {subTab === 'raster' && (
          <>
            <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-[var(--text-primary)]">
                  {lang === 'ja' ? '日本向けアニメ・漫画シェーダー' : 'Japanese Anime & Manga Shader'}
                </span>
                <span className="font-mono-tech text-[9px] text-[var(--accent-mint)]">2× AA + Toon</span>
              </div>

              {/* Japanese Market & Manga Shader Presets */}
              <div className="grid grid-cols-3 gap-1">
                {ANIME_SHADER_PRESET_CATALOG.map((p) => {
                  const active = rasterSettings.animeShaderPreset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      data-testid={`raster-preset-${p.id}`}
                      onClick={() => onChangeRasterSettings(getAnimeShaderPresetDefaults(p.id))}
                      className={`rounded border px-1.5 py-1 text-[10px] font-medium transition-colors ${
                        active
                          ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/20 text-[var(--accent-sakura-strong)]'
                          : 'border-white/10 bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-white'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={rasterSettings.style}
                  onChange={(e) => onChangeRasterSettings({ style: e.target.value as RasterStyleMode })}
                  aria-label="Raster Style"
                  className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px]"
                >
                  <option value="colored_cel">Colored Cel</option>
                  <option value="flat_color">Flat Color</option>
                  <option value="monochrome_ink">Monochrome Ink</option>
                  <option value="screentone">Screentone</option>
                </select>

                <select
                  value={String(rasterSettings.resolutionWidth)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    onChangeRasterSettings({ resolutionWidth: n, resolutionHeight: n });
                  }}
                  aria-label="Raster Resolution"
                  className="rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px]"
                >
                  {RASTER_RESOLUTION_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.width}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Anime Shader Switches */}
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                <label className="flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-1)] px-1.5 py-1 text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="raster-toon-shader-toggle"
                    checked={rasterSettings.use3DToonShader}
                    onChange={(e) => onChangeRasterSettings({ use3DToonShader: e.target.checked })}
                    className="accent-[var(--accent-sakura)]"
                  />
                  <span className="truncate">Toon 3D</span>
                </label>
                <label className="flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-1)] px-1.5 py-1 text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="raster-supersample-toggle"
                    checked={rasterSettings.supersample2x}
                    onChange={(e) => onChangeRasterSettings({ supersample2x: e.target.checked })}
                    className="accent-[var(--accent-mint)]"
                  />
                  <span className="truncate">2× AA</span>
                </label>
                <label className="flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-1)] px-1.5 py-1 text-[var(--text-secondary)] cursor-pointer" title="Protect eyes, iris colors, catchlights, mouth, and hair strands from heavy shadow/ink">
                  <input
                    type="checkbox"
                    data-testid="raster-preserve-face-toggle"
                    checked={rasterSettings.preserveFaceDetails}
                    onChange={(e) => onChangeRasterSettings({ preserveFaceDetails: e.target.checked })}
                    className="accent-[var(--accent-sakura)]"
                  />
                  <span className="truncate">Eyes/Hair</span>
                </label>
              </div>

              {/* Ink Pen, Shadow Tint, Panel Effect, BG Harmony */}
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <label className="block text-[var(--text-secondary)]">
                  Ink Pen Nib
                  <select
                    value={rasterSettings.inkPenStyle}
                    onChange={(e) => onChangeRasterSettings({ inkPenStyle: e.target.value as InkPenStyle })}
                    aria-label="Ink Pen Nib"
                    className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
                  >
                    <option value="g_pen">G-Pen (Crisp Manga)</option>
                    <option value="maru_pen">Maru-Pen (Fine Hair/Eyes)</option>
                    <option value="fude_brush">Fude Brush (Heavy Ink)</option>
                  </select>
                </label>
                <label className="block text-[var(--text-secondary)]">
                  Shadow Tint
                  <select
                    value={rasterSettings.shadowTint}
                    onChange={(e) => onChangeRasterSettings({ shadowTint: e.target.value as AnimeShadowTint })}
                    aria-label="Shadow Tint"
                    className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
                  >
                    <option value="cool_violet">Cool Violet (Anime Cel)</option>
                    <option value="warm_sepia">Warm Sepia (Shojo)</option>
                    <option value="neutral_ink">Neutral Ink</option>
                  </select>
                </label>
                <label className="block text-[var(--text-secondary)]">
                  BG Harmony
                  <select
                    value={rasterSettings.backgroundHarmony}
                    onChange={(e) =>
                      onChangeRasterSettings({ backgroundHarmony: e.target.value as BackgroundHarmonyMode })
                    }
                    aria-label="Background Harmony"
                    className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
                  >
                    <option value="anime_paint">Anime Painted BG</option>
                    <option value="manga_tone">Manga Screentone BG</option>
                    <option value="raw_photo">Raw Backdrop</option>
                  </select>
                </label>
                <label className="block text-[var(--text-secondary)]">
                  Panel Effect
                  <select
                    value={rasterSettings.mangaOverlayEffect}
                    onChange={(e) =>
                      onChangeRasterSettings({ mangaOverlayEffect: e.target.value as MangaOverlayEffect })
                    }
                    aria-label="Manga Panel Effect"
                    className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
                  >
                    <option value="none">None</option>
                    <option value="radial_focus">Focus Speedlines</option>
                    <option value="manga_border">Manga Frame (Koma)</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <label className="block text-[10px] text-[var(--text-secondary)]">
                  Outer Line: {rasterSettings.exteriorLineWidth}px
                  <input
                    type="range"
                    min={0}
                    max={6}
                    step={1}
                    value={rasterSettings.exteriorLineWidth}
                    onChange={(e) => onChangeRasterSettings({ exteriorLineWidth: Number(e.target.value) })}
                    className="w-full accent-[var(--accent-sakura)]"
                  />
                </label>

                <label className="block text-[10px] text-[var(--text-secondary)]">
                  Inner Edges: {rasterSettings.internalEdgeThreshold.toFixed(2)}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rasterSettings.internalEdgeThreshold}
                    onChange={(e) => onChangeRasterSettings({ internalEdgeThreshold: Number(e.target.value) })}
                    className="w-full accent-[var(--accent-sakura)]"
                  />
                </label>

                <label className="block text-[10px] text-[var(--text-secondary)]">
                  Sharpness: {Math.round(rasterSettings.detailSharpness * 100)}%
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rasterSettings.detailSharpness}
                    data-testid="raster-detail-sharpness"
                    onChange={(e) => onChangeRasterSettings({ detailSharpness: Number(e.target.value) })}
                    className="w-full accent-[var(--accent-mint)]"
                  />
                </label>

                <label className="block text-[10px] text-[var(--text-secondary)]">
                  Rim Glow: {Math.round(rasterSettings.rimGlow * 100)}%
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rasterSettings.rimGlow}
                    onChange={(e) => onChangeRasterSettings({ rimGlow: Number(e.target.value) })}
                    className="w-full accent-[var(--accent-mint)]"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between gap-2 text-[10px]">
                <label className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={rasterSettings.transparentBackground}
                    onChange={(e) => onChangeRasterSettings({ transparentBackground: e.target.checked })}
                  />
                  Transparent BG
                </label>
                <div className="flex items-center gap-1">
                  <span>Paper:</span>
                  <input
                    type="color"
                    value={rasterSettings.backgroundHex}
                    onChange={(e) => onChangeRasterSettings({ backgroundHex: e.target.value })}
                    className="h-5 w-7 cursor-pointer rounded border border-white/15 bg-transparent"
                  />
                </div>
              </div>

              {/* Camera Raster Controls: Shot Framing + 8x Zoom + Pan X/Y + Lens FOV + Orbit/Tilt/Roll */}
              <div className="rounded border border-white/10 bg-[var(--surface-1)] p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-primary)]">
                    <Camera className="h-3 w-3 text-[var(--accent-mint)]" />
                    Camera Raster (Shot &amp; Lens)
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        onChangeRasterSettings({
                          cameraZoom: Math.max(0.25, Number((rasterSettings.cameraZoom - 0.25).toFixed(2))),
                        })
                      }
                      data-testid="raster-cam-zoom-out"
                      title="Zoom Out"
                      className="rounded border border-white/10 bg-[var(--surface-2)] p-1 text-[10px] hover:text-white"
                    >
                      <ZoomOut className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeRasterSettings({
                          cameraZoom: Math.min(8.0, Number((rasterSettings.cameraZoom + 0.25).toFixed(2))),
                        })
                      }
                      data-testid="raster-cam-zoom-in"
                      title="Zoom In"
                      className="rounded border border-white/10 bg-[var(--surface-2)] p-1 text-[10px] hover:text-white"
                    >
                      <ZoomIn className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={onResetRasterCamera}
                      data-testid="raster-cam-reset"
                      className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:text-white"
                    >
                      <RotateCcw className="h-2.5 w-2.5" /> Reset
                    </button>
                  </div>
                </div>

                {/* Bone-Aware Framing Presets + Exact Live Viewport */}
                <div className="space-y-1">
                  <span className="text-[9px] text-[var(--text-muted)]">Shot Framing Target:</span>
                  <div className="grid grid-cols-4 gap-1">
                    {(
                      [
                        { id: 'wide', label: 'Wide Body' },
                        { id: 'full', label: 'Full Fit' },
                        { id: 'knee', label: 'Knee Up' },
                        { id: 'waist', label: 'Waist' },
                        { id: 'bust', label: 'Bust' },
                        { id: 'face', label: 'Face' },
                        { id: 'viewport_exact', label: 'Live 3D' },
                      ] as Array<{ id: CameraFramingPreset; label: string }>
                    ).map((fr) => {
                      const active = rasterSettings.cameraFraming === fr.id;
                      return (
                        <button
                          key={fr.id}
                          type="button"
                          data-testid={`raster-framing-${fr.id}`}
                          onClick={() => onChangeRasterSettings({ cameraFraming: fr.id })}
                          className={`rounded border py-1 text-[9px] font-medium ${
                            active
                              ? 'border-[var(--accent-mint)] bg-[var(--accent-mint)]/20 text-[var(--accent-mint)]'
                              : 'border-white/10 bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-white'
                          }`}
                        >
                          {fr.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block text-[10px] text-[var(--text-secondary)]">
                    <div className="flex justify-between font-mono-tech">
                      <span>Zoom</span>
                      <span>{rasterSettings.cameraZoom.toFixed(2)}×</span>
                    </div>
                    <input
                      type="range"
                      min={0.25}
                      max={8.0}
                      step={0.05}
                      value={rasterSettings.cameraZoom}
                      data-testid="raster-cam-zoom"
                      onChange={(e) => onChangeRasterSettings({ cameraZoom: Number(e.target.value) })}
                      className="w-full accent-[var(--accent-mint)]"
                    />
                  </label>
                  <label className="block text-[10px] text-[var(--text-secondary)]">
                    <div className="flex justify-between font-mono-tech">
                      <span>Lens FOV</span>
                      <span>{rasterSettings.cameraFov.toFixed(0)}°</span>
                    </div>
                    <input
                      type="range"
                      min={18}
                      max={75}
                      step={1}
                      value={rasterSettings.cameraFov}
                      data-testid="raster-cam-fov"
                      onChange={(e) => onChangeRasterSettings({ cameraFov: Number(e.target.value) })}
                      className="w-full accent-[var(--accent-mint)]"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block text-[10px] text-[var(--text-secondary)]">
                    <div className="flex justify-between font-mono-tech">
                      <span>Pan X</span>
                      <span>{rasterSettings.cameraPanX >= 0 ? '+' : ''}{rasterSettings.cameraPanX.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={-1.5}
                      max={1.5}
                      step={0.05}
                      value={rasterSettings.cameraPanX}
                      data-testid="raster-cam-panx"
                      onChange={(e) => onChangeRasterSettings({ cameraPanX: Number(e.target.value) })}
                      className="w-full accent-[var(--accent-mint)]"
                    />
                  </label>
                  <label className="block text-[10px] text-[var(--text-secondary)]">
                    <div className="flex justify-between font-mono-tech">
                      <span>Pan Y</span>
                      <span>{rasterSettings.cameraPanY >= 0 ? '+' : ''}{rasterSettings.cameraPanY.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={-1.5}
                      max={1.5}
                      step={0.05}
                      value={rasterSettings.cameraPanY}
                      data-testid="raster-cam-pany"
                      onChange={(e) => onChangeRasterSettings({ cameraPanY: Number(e.target.value) })}
                      className="w-full accent-[var(--accent-mint)]"
                    />
                  </label>
                </div>

                <label className="block text-[10px] text-[var(--text-secondary)]">
                  <div className="flex justify-between font-mono-tech">
                    <span>Rotate Camera (Yaw)</span>
                    <span>{rasterSettings.cameraOrbitYawDeg.toFixed(0)}°</span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={rasterSettings.cameraOrbitYawDeg}
                    data-testid="raster-cam-yaw"
                    onChange={(e) => onChangeRasterSettings({ cameraOrbitYawDeg: Number(e.target.value) })}
                    className="w-full accent-[var(--accent-sakura)]"
                  />
                </label>

                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block text-[10px] text-[var(--text-secondary)]">
                    <div className="flex justify-between font-mono-tech">
                      <span>Pitch</span>
                      <span>{rasterSettings.cameraOrbitPitchDeg.toFixed(0)}°</span>
                    </div>
                    <input
                      type="range"
                      min={-60}
                      max={60}
                      step={5}
                      value={rasterSettings.cameraOrbitPitchDeg}
                      data-testid="raster-cam-pitch"
                      onChange={(e) => onChangeRasterSettings({ cameraOrbitPitchDeg: Number(e.target.value) })}
                      className="w-full accent-[var(--accent-sakura)]"
                    />
                  </label>
                  <label className="block text-[10px] text-[var(--text-secondary)]">
                    <div className="flex justify-between font-mono-tech">
                      <span>Roll</span>
                      <span>{rasterSettings.cameraRollDeg.toFixed(0)}°</span>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={5}
                      value={rasterSettings.cameraRollDeg}
                      data-testid="raster-cam-roll"
                      onChange={(e) => onChangeRasterSettings({ cameraRollDeg: Number(e.target.value) })}
                      className="w-full accent-[var(--accent-sakura)]"
                    />
                  </label>
                </div>
              </div>

              {/* Raster Scene Image Uploads (Backgrounds, Props, Optional Reference) */}
              <div className="rounded border border-white/10 bg-[var(--surface-1)] p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-primary)]">
                    <Layers className="h-3 w-3 text-[var(--accent-sakura)]" />
                    Scene Images (3D · Front · Side · Back)
                  </span>
                </div>

                {/* 1. Background Images */}
                <div className="space-y-1 rounded border border-white/10 bg-[var(--surface-0)] p-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-medium text-[var(--text-primary)]">
                      Background Image(s) ({rasterSceneAssets.backgroundImages.length})
                    </span>
                    <div className="flex items-center gap-1">
                      <label className="cursor-pointer rounded border border-[var(--accent-mint)]/50 bg-[var(--accent-mint)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/25">
                        + Upload
                        <input
                          type="file"
                          multiple
                          accept="image/png,image/jpeg,image/webp"
                          data-testid="raster-upload-background"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              onAddRasterSceneImages('backgroundImages', e.target.files);
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {rasterSceneAssets.backgroundImages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onClearRasterSceneCategory('backgroundImages')}
                          className="rounded border border-white/10 p-0.5 text-[10px] text-red-300 hover:bg-red-500/20"
                          title="Clear background images"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {rasterSceneAssets.backgroundImages.length > 0 && (
                    <>
                      <div className="flex gap-1 overflow-x-auto pb-0.5">
                        {rasterSceneAssets.backgroundImages.map((img) => (
                          <div key={img.id} className="relative h-10 w-10 shrink-0 rounded border border-white/15 overflow-hidden bg-black">
                            <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => onRemoveRasterSceneImage('backgroundImages', img.id)}
                              aria-label={`Remove background ${img.name}`}
                              className="absolute right-0 top-0 bg-black/75 px-1 text-[9px] text-red-300 hover:text-white"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rasterSettings.stylizeBackground}
                          onChange={(e) => onChangeRasterSettings({ stylizeBackground: e.target.checked })}
                          className="accent-[var(--accent-sakura)]"
                        />
                        <span>Apply Manga/Ink rasterizer to Background</span>
                      </label>
                    </>
                  )}
                </div>

                {/* 2. Props Images */}
                <div className="space-y-1 rounded border border-white/10 bg-[var(--surface-0)] p-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-medium text-[var(--text-primary)]">
                      Props Image(s) ({rasterSceneAssets.propImages.length})
                    </span>
                    <div className="flex items-center gap-1">
                      <label className="cursor-pointer rounded border border-[var(--accent-sakura)]/50 bg-[var(--accent-sakura)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/25">
                        + Upload
                        <input
                          type="file"
                          multiple
                          accept="image/png,image/jpeg,image/webp"
                          data-testid="raster-upload-props"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              onAddRasterSceneImages('propImages', e.target.files);
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {rasterSceneAssets.propImages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onClearRasterSceneCategory('propImages')}
                          className="rounded border border-white/10 p-0.5 text-[10px] text-red-300 hover:bg-red-500/20"
                          title="Clear prop images"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {rasterSceneAssets.propImages.length > 0 && (
                    <>
                      <div className="flex gap-1 overflow-x-auto pb-0.5">
                        {rasterSceneAssets.propImages.map((img) => (
                          <div key={img.id} className="relative h-10 w-10 shrink-0 rounded border border-white/15 overflow-hidden bg-black">
                            <img src={img.dataUrl} alt={img.name} className="h-full w-full object-contain" />
                            <button
                              type="button"
                              onClick={() => onRemoveRasterSceneImage('propImages', img.id)}
                              aria-label={`Remove prop ${img.name}`}
                              className="absolute right-0 top-0 bg-black/75 px-1 text-[9px] text-red-300 hover:text-white"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-1 pt-0.5 text-[9px] text-[var(--text-secondary)]">
                        <label>
                          Scale {rasterSettings.propScale.toFixed(2)}×
                          <input
                            type="range"
                            min={0.25}
                            max={2.5}
                            step={0.05}
                            value={rasterSettings.propScale}
                            onChange={(e) => onChangeRasterSettings({ propScale: Number(e.target.value) })}
                            className="w-full accent-[var(--accent-sakura)]"
                          />
                        </label>
                        <label>
                          X {rasterSettings.propOffsetX.toFixed(2)}
                          <input
                            type="range"
                            min={-1.5}
                            max={1.5}
                            step={0.05}
                            value={rasterSettings.propOffsetX}
                            onChange={(e) => onChangeRasterSettings({ propOffsetX: Number(e.target.value) })}
                            className="w-full accent-[var(--accent-sakura)]"
                          />
                        </label>
                        <label>
                          Y {rasterSettings.propOffsetY.toFixed(2)}
                          <input
                            type="range"
                            min={-1.0}
                            max={1.5}
                            step={0.05}
                            value={rasterSettings.propOffsetY}
                            onChange={(e) => onChangeRasterSettings({ propOffsetY: Number(e.target.value) })}
                            className="w-full accent-[var(--accent-sakura)]"
                          />
                        </label>
                      </div>
                    </>
                  )}
                </div>

                {/* 3. Other Reference Images (Optional) */}
                <div className="space-y-1 rounded border border-white/10 bg-[var(--surface-0)] p-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-medium text-[var(--text-primary)]">
                      Other Reference (Optional) ({rasterSceneAssets.referenceImages.length})
                    </span>
                    <div className="flex items-center gap-1">
                      <label className="cursor-pointer rounded border border-white/20 bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] hover:text-white">
                        + Upload
                        <input
                          type="file"
                          multiple
                          accept="image/png,image/jpeg,image/webp"
                          data-testid="raster-upload-reference"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              onAddRasterSceneImages('referenceImages', e.target.files);
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {rasterSceneAssets.referenceImages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onClearRasterSceneCategory('referenceImages')}
                          className="rounded border border-white/10 p-0.5 text-[10px] text-red-300 hover:bg-red-500/20"
                          title="Clear optional reference images"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {rasterSceneAssets.referenceImages.length > 0 && (
                    <>
                      <div className="flex gap-1 overflow-x-auto pb-0.5">
                        {rasterSceneAssets.referenceImages.map((img) => (
                          <div key={img.id} className="relative h-10 w-10 shrink-0 rounded border border-white/15 overflow-hidden bg-black">
                            <img src={img.dataUrl} alt={img.name} className="h-full w-full object-contain" />
                            <button
                              type="button"
                              onClick={() => onRemoveRasterSceneImage('referenceImages', img.id)}
                              aria-label={`Remove reference ${img.name}`}
                              className="absolute right-0 top-0 bg-black/75 px-1 text-[9px] text-red-300 hover:text-white"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rasterSettings.includeReferenceOverlay}
                          onChange={(e) =>
                            onChangeRasterSettings({ includeReferenceOverlay: e.target.checked })
                          }
                          className="accent-[var(--accent-mint)]"
                        />
                        <span>Show optional reference inset & include in ZIP</span>
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* View Selector for Multi-View Raster */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--text-secondary)]">Capture Views:</span>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeRasterSettings({
                        selectedViews: ['perspective', 'front', 'side', 'back'],
                      })
                    }
                    className="text-[10px] text-[var(--accent-mint)] hover:underline"
                  >
                    Select All 4 Views
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {(['perspective', 'front', 'side', 'back'] as CameraPreset[]).map((v) => {
                    const checked = rasterSettings.selectedViews.includes(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          const next = checked
                            ? rasterSettings.selectedViews.filter((x) => x !== v)
                            : [...rasterSettings.selectedViews, v];
                          if (next.length > 0) onChangeRasterSettings({ selectedViews: next });
                        }}
                        className={`rounded border py-1 text-[10px] capitalize ${
                          checked
                            ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/20 text-[var(--accent-sakura-strong)]'
                            : 'border-white/10 bg-[var(--surface-2)] text-[var(--text-muted)]'
                        }`}
                      >
                        {v === 'perspective' ? '3D' : v}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 pt-1">
                {rasterBusy ? (
                  <button
                    type="button"
                    onClick={onCancelRaster}
                    className="rounded border border-red-400/50 bg-red-500/20 py-1.5 text-xs font-medium text-red-200"
                  >
                    Cancel Capture (Restores Camera/Materials)
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void onRunRasterCapture(rasterSettings.selectedViews)}
                      className="inline-flex items-center justify-center gap-1.5 rounded bg-[var(--accent-sakura)] py-2 text-xs font-semibold text-[#0D0F18] hover:bg-[var(--accent-sakura-strong)]"
                      data-testid="multi-view-raster-btn"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      {strings.rasterGenerateMultiView}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRunRasterCapture(['perspective'])}
                      className="rounded border border-white/15 bg-[var(--surface-2)] py-1.5 text-[11px] hover:border-white/30"
                    >
                      {strings.rasterSingleCapture}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Raster Preview, Interactive 2D Character Move Gizmo & Downloads */}
            {activeRaster && (
              <div
                className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2"
                data-testid="raster-output-preview"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-[var(--text-primary)]">
                    Output: {activeRaster.view.toUpperCase()} ({activeRaster.width}×{activeRaster.height})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRasterGizmoVisible((v) => !v)}
                      data-testid="raster-gizmo-toggle"
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                        rasterGizmoVisible
                          ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/20 text-[var(--accent-sakura-strong)]'
                          : 'border-white/15 bg-[var(--surface-2)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <Move className="h-2.5 w-2.5" /> Move Gizmo
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadRasterZip(activeRaster)}
                      className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-mint)] hover:underline"
                    >
                      <Download className="h-3 w-3" /> Passes ZIP
                    </button>
                  </div>
                </div>

                {/* Fixed Background + Movable Rasterized Character Stage */}
                {(() => {
                  const fgOx = activeRaster.foregroundOffsetX ?? 0;
                  const fgOy = activeRaster.foregroundOffsetY ?? 0;
                  const fgScale = activeRaster.foregroundScale ?? 1;
                  const hasSeparateLayers = Boolean(activeRaster.foregroundDataUrl);
                  const center = activeRaster.foregroundContentCenter ?? { x: 0.5, y: 0.5 };
                  const gizmoX = Math.max(8, Math.min(92, (0.5 + fgOx + fgScale * (center.x - 0.5)) * 100));
                  const gizmoY = Math.max(8, Math.min(92, (0.5 + fgOy + fgScale * (center.y - 0.5)) * 100));

                  return (
                    <>
                      <div
                        ref={rasterStageRef}
                        data-testid="raster-interactive-stage"
                        className="relative mx-auto aspect-square w-full max-w-[264px] overflow-hidden rounded border border-white/15 bg-[#090b10] select-none touch-none"
                        style={
                          !activeRaster.backgroundDataUrl
                            ? {
                                backgroundImage:
                                  'linear-gradient(45deg, #161a26 25%, transparent 25%), linear-gradient(-45deg, #161a26 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #161a26 75%), linear-gradient(-45deg, transparent 75%, #161a26 75%)',
                                backgroundSize: '16px 16px',
                                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                              }
                            : undefined
                        }
                      >
                        {/* 1. Fixed Background Image Layer */}
                        {activeRaster.backgroundDataUrl && (
                          <img
                            src={activeRaster.backgroundDataUrl}
                            alt={`Fixed Background ${activeRaster.view}`}
                            draggable={false}
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                          />
                        )}

                        {/* 2. Movable Rasterized Character Layer */}
                        <img
                          src={activeRaster.foregroundDataUrl || activeRaster.combinedDataUrl}
                          alt={`Raster ${activeRaster.view}`}
                          draggable={false}
                          data-testid="raster-foreground-img"
                          onPointerDown={(e) => {
                            if (hasSeparateLayers) startRasterDrag('xy', e);
                          }}
                          style={{
                            transform: `translate(${fgOx * 100}%, ${fgOy * 100}%) scale(${fgScale})`,
                            transformOrigin: 'center center',
                          }}
                          className={`absolute inset-0 h-full w-full object-contain ${
                            hasSeparateLayers ? 'cursor-move' : ''
                          }`}
                        />

                        {/* 3. Interactive 2D XY Move Gizmo (Horizontal X + Vertical Y + Center XY) */}
                        {rasterGizmoVisible && hasSeparateLayers && (
                          <div
                            data-testid="raster-move-gizmo"
                            style={{
                              left: `${gizmoX}%`,
                              top: `${gizmoY}%`,
                              transform: 'translate(-50%, -50%)',
                            }}
                            className="pointer-events-none absolute z-20 h-24 w-24"
                          >
                            {/* Vertical Y Axis Handle (Green / Mint) */}
                            <button
                              type="button"
                              data-testid="raster-gizmo-y"
                              aria-label="Move character vertically"
                              title="Drag vertically (Y) keeping background fixed"
                              onPointerDown={(e) => startRasterDrag('y', e)}
                              className={`pointer-events-auto absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center cursor-ns-resize group ${
                                rasterDragMode === 'y' ? 'scale-110' : ''
                              }`}
                            >
                              <span className="rounded bg-[#0d111a]/90 px-1 text-[9px] font-bold text-[#78f0c8] ring-1 ring-[#78f0c8]/60">
                                ▲ Y
                              </span>
                              <span className="h-7 w-[3px] bg-[#78f0c8] shadow-[0_0_6px_rgba(120,240,200,0.85)]" />
                            </button>

                            {/* Horizontal X Axis Handle (Pink / Red) */}
                            <button
                              type="button"
                              data-testid="raster-gizmo-x"
                              aria-label="Move character horizontally"
                              title="Drag horizontally (X) keeping background fixed"
                              onPointerDown={(e) => startRasterDrag('x', e)}
                              className={`pointer-events-auto absolute right-0 top-1/2 flex -translate-y-1/2 items-center cursor-ew-resize group ${
                                rasterDragMode === 'x' ? 'scale-110' : ''
                              }`}
                            >
                              <span className="h-[3px] w-7 bg-[#ff7597] shadow-[0_0_6px_rgba(255,117,151,0.85)]" />
                              <span className="rounded bg-[#0d111a]/90 px-1 text-[9px] font-bold text-[#ff7597] ring-1 ring-[#ff7597]/60">
                                X ▶
                              </span>
                            </button>

                            {/* Center XY Free-Move Ring */}
                            <button
                              type="button"
                              data-testid="raster-gizmo-center"
                              aria-label="Move character horizontally and vertically"
                              title="Drag horizontally & vertically keeping background fixed"
                              onPointerDown={(e) => startRasterDrag('xy', e)}
                              className={`pointer-events-auto absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#78f0c8] bg-[#0d111a]/80 text-white shadow-[0_0_10px_rgba(0,0,0,0.75)] cursor-move hover:border-[#ff7597] ${
                                rasterDragMode === 'xy' ? 'ring-2 ring-[#ff7597]' : ''
                              }`}
                            >
                              <Move className="h-3.5 w-3.5 text-white" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Character Placement Fine Controls (Horizontal X, Vertical Y, Scale) */}
                      {hasSeparateLayers && (
                        <div className="rounded border border-white/10 bg-[var(--surface-1)] p-2 space-y-1.5">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-semibold text-[var(--text-primary)]">
                              Character Placement (BG Fixed)
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                data-testid="raster-move-reset"
                                onClick={() =>
                                  onUpdateRasterPlacement(activeRaster.id, {
                                    foregroundOffsetX: 0,
                                    foregroundOffsetY: 0,
                                    foregroundScale: 1,
                                  })
                                }
                                className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)] hover:text-white"
                              >
                                <RotateCcw className="h-2.5 w-2.5" /> Center
                              </button>
                              {rasterOutputs.length > 1 && (
                                <button
                                  type="button"
                                  data-testid="raster-apply-all-views"
                                  onClick={() =>
                                    onUpdateRasterPlacement(
                                      activeRaster.id,
                                      {
                                        foregroundOffsetX: fgOx,
                                        foregroundOffsetY: fgOy,
                                        foregroundScale: fgScale,
                                      },
                                      true
                                    )
                                  }
                                  className="rounded border border-[var(--accent-mint)]/40 bg-[var(--accent-mint)]/15 px-1.5 py-0.5 text-[9px] font-medium text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/25"
                                >
                                  Apply All Views
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 text-[9px] text-[var(--text-secondary)]">
                            <label>
                              <div className="flex justify-between font-mono-tech">
                                <span>Move X</span>
                                <span>{Math.round(fgOx * 100)}%</span>
                              </div>
                              <input
                                type="range"
                                min={-0.85}
                                max={0.85}
                                step={0.01}
                                value={fgOx}
                                data-testid="raster-move-x"
                                onChange={(e) =>
                                  onUpdateRasterPlacement(activeRaster.id, {
                                    foregroundOffsetX: Number(e.target.value),
                                  })
                                }
                                className="w-full accent-[var(--accent-sakura)]"
                              />
                            </label>
                            <label>
                              <div className="flex justify-between font-mono-tech">
                                <span>Move Y</span>
                                <span>{Math.round(fgOy * 100)}%</span>
                              </div>
                              <input
                                type="range"
                                min={-0.85}
                                max={0.85}
                                step={0.01}
                                value={fgOy}
                                data-testid="raster-move-y"
                                onChange={(e) =>
                                  onUpdateRasterPlacement(activeRaster.id, {
                                    foregroundOffsetY: Number(e.target.value),
                                  })
                                }
                                className="w-full accent-[var(--accent-mint)]"
                              />
                            </label>
                            <label>
                              <div className="flex justify-between font-mono-tech">
                                <span>Scale</span>
                                <span>{fgScale.toFixed(2)}×</span>
                              </div>
                              <input
                                type="range"
                                min={0.35}
                                max={2.2}
                                step={0.05}
                                value={fgScale}
                                data-testid="raster-char-scale"
                                onChange={(e) =>
                                  onUpdateRasterPlacement(activeRaster.id, {
                                    foregroundScale: Number(e.target.value),
                                  })
                                }
                                className="w-full accent-[var(--accent-sakura)]"
                              />
                            </label>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  {[
                    { key: 'combined' as const, label: 'Combined', url: activeRaster.combinedDataUrl },
                    { key: 'line' as const, label: 'Line Ink', url: activeRaster.linePassDataUrl },
                    { key: 'color' as const, label: 'Color', url: activeRaster.colorPassDataUrl },
                    { key: 'shadow' as const, label: 'Shadow', url: activeRaster.shadowPassDataUrl },
                  ].map((pass) =>
                    pass.url ? (
                      <button
                        key={pass.label}
                        type="button"
                        onClick={() => void handleDownloadRasterLayer(activeRaster, pass.key, pass.label)}
                        className="rounded border border-white/10 bg-[var(--surface-2)] py-1 text-center hover:border-[var(--accent-sakura)]/50"
                      >
                        {pass.label}
                      </button>
                    ) : null
                  )}
                </div>

                {/* Free AI Art Director Critique & Auto-Tune */}
                <div className="rounded border border-white/10 bg-[var(--surface-1)] p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-primary)]">
                      <Sparkles className="h-3 w-3 text-[var(--accent-sakura)]" />
                      AI Art Director (Free)
                    </span>
                    <button
                      type="button"
                      disabled={aiCritiqueBusy}
                      data-testid="raster-ai-critique-btn"
                      onClick={async () => {
                        setAiCritiqueBusy(true);
                        setAiCritiqueError(null);
                        try {
                          const compositeUrl = await composeRasterRecordExportDataUrl(activeRaster, 'combined');
                          const res = await critiqueRasterRequest({
                            imageDataUrl: compositeUrl,
                            language: lang,
                            currentPreset: rasterSettings.animeShaderPreset,
                          });
                          setAiCritiqueResult(res);
                        } catch (err) {
                          setAiCritiqueError((err as Error).message);
                        } finally {
                          setAiCritiqueBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded border border-[var(--accent-sakura)]/50 bg-[var(--accent-sakura)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/25 disabled:opacity-50"
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      {aiCritiqueBusy ? 'Analyzing...' : 'Critique & Suggest'}
                    </button>
                  </div>

                  {aiCritiqueError && (
                    <div className="text-[10px] text-red-300">{aiCritiqueError}</div>
                  )}

                  {aiCritiqueResult && (
                    <div className="space-y-1.5 text-[10px]" data-testid="raster-ai-critique-card">
                      <p className="leading-relaxed text-[var(--text-secondary)]">
                        {aiCritiqueResult.critique}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-mono-tech text-[9px] text-[var(--text-muted)]">
                          {aiCritiqueResult.suggestedPreset} · {aiCritiqueResult.suggestedPenStyle} ·{' '}
                          {aiCritiqueResult.suggestedLineWidth}px
                        </span>
                        <button
                          type="button"
                          data-testid="raster-ai-apply-btn"
                          onClick={() => {
                            const patch: Partial<RasterRenderSettings> = {
                              ...getAnimeShaderPresetDefaults(aiCritiqueResult.suggestedPreset),
                              use3DToonShader: true,
                              supersample2x: true,
                              inkPenStyle: aiCritiqueResult.suggestedPenStyle,
                              shadowTint: aiCritiqueResult.suggestedShadowTint,
                              backgroundHarmony: aiCritiqueResult.suggestedBackgroundHarmony,
                              exteriorLineWidth: aiCritiqueResult.suggestedLineWidth,
                              internalEdgeThreshold: aiCritiqueResult.suggestedEdgeThreshold,
                              rimGlow: aiCritiqueResult.suggestedRimGlow,
                            };
                            const nextSettings = validateRasterSettings({
                              ...rasterSettings,
                              ...patch,
                            });
                            onChangeRasterSettings(patch);
                            void onRunRasterCapture([activeRaster.view], nextSettings);
                          }}
                          className="rounded bg-[var(--accent-mint)] px-2 py-0.5 text-[10px] font-semibold text-[#0D0F18] hover:opacity-90"
                        >
                          Apply AI Settings &amp; Re-Raster
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {rasterOutputs.length > 1 && (
                  <div className="flex gap-1 overflow-x-auto pt-1">
                    {rasterOutputs.map((ro) => (
                      <button
                        key={ro.id}
                        type="button"
                        onClick={() => onSelectRasterId(ro.id)}
                        className={`shrink-0 rounded border p-1 ${
                          ro.id === activeRaster.id
                            ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/15'
                            : 'border-white/10 bg-[var(--surface-1)]'
                        }`}
                      >
                        <ImageIcon className="h-3.5 w-3.5 mx-auto" />
                        <span className="block text-[9px] uppercase">
                          {ro.view === 'perspective' ? '3D' : ro.view}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
