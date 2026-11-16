import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Bone, Film, FolderKanban, Image, Layers, Maximize2, Minimize2, PersonStanding } from 'lucide-react';
import {
  ACTIVE_WORKSPACE_IDS,
  clampTimelineDuration,
  sanitizeProjectManifest,
  type BoneRotationMap,
  type CameraPreset,
  type EnvironmentBackground,
  type LanguageCode,
  type MaterialAppearanceSettings,
  type NamedPose,
  type PortableProjectManifest,
  type PoseKeyframe,
  type PropAttachment,
  type ThemeMode,
  type TimelineClipItem,
  type TimelineMode,
  type WorkspaceId,
} from '../shared/studio';
import type {
  CharacterClipSetting,
  PbrTextureSlotBinding,
  PortableCharacterManifest,
} from '../shared/characters';
import {
  createDefaultFingerControls,
  MAX_RASTER_TAKES_IN_PROJECT,
  type FingerControlsState,
  type IkLimbId,
  type IkTargetsMap,
  type MannequinDriverState,
  type PoseLibraryRecord,
  type RasterImageAsset,
  type RasterOutputRecord,
  type RasterRenderSettings,
  type RasterSceneAssets,
  type ReferenceImageSlot,
  type ReferenceSlotView,
  validateRasterSettings,
} from '../shared/pose-raster';
import { getStudioStrings } from './lib/i18n';
import { createDemoSkinnedCharacter } from './lib/animation/demoRig';
import {
  evaluateClipCompatibility,
  inspectObject3D,
} from './lib/animation/rigInspect';
import {
  captureRestPose,
  RestPoseSnapshot,
  solveIkTargetForRig,
} from './lib/animation/poseIk';
import { applyPbrTextureBindings, OriginalMaterialCache } from './lib/animation/materials';
import {
  buildAutoPbrBindingsFromFolderFiles,
  inferTextureChannelFromName,
  loadAnimationClipsFromFile,
  loadCharacterBundleFromFiles,
} from './lib/animation/loaders';
import {
  retargetPoseAcrossRigs,
  solveMultiViewPoseForMannequin,
  solveReferenceSlotsToBoneRotations,
} from './lib/animation/retarget';
import { samplePoseKeyframesAtTime } from './lib/animation/timeline';
import {
  composeRasterRecordExportDataUrl,
  dataUrlToUint8Array,
  exportCharacterToGlb,
  exportPoseOrClipToBvh,
  packFilesToZip,
} from './lib/animation/raster';
import { detectStillImagePose } from './lib/animation/poseDetector';
import {
  loadLocalRastersList,
  loadProjectDraftLocally,
  saveLocalRastersList,
  saveProjectDraftLocally,
} from './lib/localStore';
import {
  deletePersistedRiggedCharacter,
  deleteServerCharacter,
  deleteServerProject,
  directMotionRequest,
  listPersistedRiggedCharacters,
  listServerCharacters,
  listServerProjects,
  loadPersistedRiggedCharacterGlb,
  savePersistedRiggedCharacter,
  saveServerCharacter,
  saveServerProject,
  type PersistedRiggedCharacterDoc,
} from './lib/api';
import { validateRiggedCharacterOnly } from './lib/firebaseCharacterUtils';
import { StudioHeader } from './components/studio/StudioHeader';
import { Viewport3D, type Viewport3DHandle } from './components/studio/Viewport3D';
import { TimelineBar } from './components/studio/TimelineBar';
import { AnimationInspector } from './components/studio/AnimationInspector';
import { CharacterProduction } from './components/studio/CharacterProduction';
import { PoseDrawingWorkspace } from './components/studio/PoseDrawingWorkspace';
import { PoseLibraryWorkspace } from './components/studio/PoseLibraryWorkspace';
import { AssetLibraryWorkspace } from './components/studio/AssetLibraryWorkspace';
import { StudioGuideModal } from './components/studio/StudioGuideModal';
import { StageCharacterModal } from './components/studio/StageCharacterModal';
import { PanelSplitter } from './components/studio/PanelSplitter';
import {
  areAllSurroundingPanelsCollapsed,
  clampPanelLayout,
  DEFAULT_PANEL_LAYOUT,
  loadSavedPanelLayout,
  PANEL_LIMITS,
  savePanelLayout,
  toggleFocus3DLayout,
  toggleStageMinimizeLayout,
  type PanelLayoutState,
} from './lib/panelLayout';
import type { MotionDirectionResult } from '../server/ai';

const INITIAL_IK_TARGETS: IkTargetsMap = {
  leftHand: { enabled: false, target: { x: 0.45, y: 1.25, z: 0.25 }, poleHint: { x: 0.3, y: 1.3, z: -0.4 }, respectBendLimits: true },
  rightHand: { enabled: false, target: { x: -0.45, y: 1.25, z: 0.25 }, poleHint: { x: -0.3, y: 1.3, z: -0.4 }, respectBendLimits: true },
  leftFoot: { enabled: false, target: { x: 0.12, y: 0.15, z: 0.12 }, poleHint: { x: 0.1, y: 0.5, z: 0.5 }, respectBendLimits: true },
  rightFoot: { enabled: false, target: { x: -0.12, y: 0.15, z: 0.12 }, poleHint: { x: -0.1, y: 0.5, z: 0.5 }, respectBendLimits: true },
};

const INITIAL_REF_SLOTS: ReferenceImageSlot[] = [
  { view: 'front', imageUrl: null, imageName: null, landmarks: [], confidenceMean: 0, missingJoints: [], samePoseConfirmed: true, detectionSource: 'none' },
  { view: 'side', imageUrl: null, imageName: null, landmarks: [], confidenceMean: 0, missingJoints: [], samePoseConfirmed: false, detectionSource: 'none' },
  { view: 'back', imageUrl: null, imageName: null, landmarks: [], confidenceMean: 0, missingJoints: [], samePoseConfirmed: false, detectionSource: 'none' },
];

export default function App() {
  // Initial demo rig
  const initialDemo = useMemo(() => createDemoSkinnedCharacter('demo'), []);
  const mannequinRefRig = useMemo(() => createDemoSkinnedCharacter('mannequin'), []);
  const mannequinRestPose = useMemo(
    () => captureRestPose(mannequinRefRig.root),
    [mannequinRefRig.root]
  );
  const viewportRef = useRef<Viewport3DHandle>(null);

  const [workspace, setWorkspace] = useState<WorkspaceId>('animation');
  const [lang, setLang] = useState<LanguageCode>('en');
  const [theme, setTheme] = useState<ThemeMode>('indigo');
  const [projectId, setProjectId] = useState<string>(() => `proj-${Date.now()}`);
  const [projectName, setProjectName] = useState('RAPUSO Production 01');
  const [guideOpen, setGuideOpen] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);

  // Active 3D character runtime objects
  const [subjectRoot, setSubjectRoot] = useState<THREE.Object3D>(initialDemo.root);
  const [restPose, setRestPose] = useState<RestPoseSnapshot>(() => captureRestPose(initialDemo.root));
  const [clips, setClips] = useState<THREE.AnimationClip[]>(initialDemo.clips);
  const [activeClipName, setActiveClipName] = useState<string | null>(initialDemo.clips[0]?.name || null);
  const materialCacheRef = useRef<OriginalMaterialCache>(new WeakMap());

  const [characterManifest, setCharacterManifest] = useState<PortableCharacterManifest>(() => {
    const diag = inspectObject3D(initialDemo.root, initialDemo.clips);
    return {
      id: 'rapuso-demo-rig',
      name: 'RAPUSO Bundled Demo Humanoid',
      format: 'demo',
      isBuiltInDemo: true,
      persistenceScope: 'bundled',
      primaryFileName: 'bundled_demo_humanoid.procedural',
      primaryFileSizeBytes: 0,
      companionFiles: [],
      textureBindings: [],
      clipSettings: initialDemo.clips.map((c) => evaluateClipCompatibility(c, initialDemo.root, 'preset')),
      diagnostics: diag,
    };
  });

  // Timeline & playback state
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('clips');
  const [timelineDurationSec, setTimelineDurationSec] = useState(12);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopPlayback, setLoopPlayback] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [timelineClips, setTimelineClips] = useState<TimelineClipItem[]>(() =>
    initialDemo.clips.map((c, idx) => ({
      id: `tc-${idx}`,
      sourceClipName: c.name,
      label: c.name,
      startSec: idx * 3,
      durationSec: c.duration,
      speed: 1,
      loop: true,
      sourceKind: 'preset',
    }))
  );
  const [poseKeyframes, setPoseKeyframes] = useState<PoseKeyframe[]>([]);

  // Posing, Undo stack, Fingers, IK, Mannequin Driver
  const [selectedBoneName, setSelectedBoneName] = useState<string | null>('LeftForeArm');
  const [showGizmoRings, setShowGizmoRings] = useState(true);
  const [manualBoneRotations, setManualBoneRotations] = useState<BoneRotationMap>({});
  const [manualBonePositions, setManualBonePositions] = useState<BoneRotationMap>({});
  const [poseUndoStack, setPoseUndoStack] = useState<BoneRotationMap[]>([]);
  const [savedPoses, setSavedPoses] = useState<NamedPose[]>([]);
  const [fingerControls, setFingerControls] = useState<FingerControlsState>(createDefaultFingerControls);
  const [ikTargets, setIkTargets] = useState<IkTargetsMap>(INITIAL_IK_TARGETS);
  const [driverState, setDriverState] = useState<MannequinDriverState>({
    liveFollow: false,
    driverBoneRotations: {},
    driverBonePositions: {},
    driverFingerControls: createDefaultFingerControls(),
  });

  // 2D Reference & Raster Outputs
  const [referenceSlots, setReferenceSlots] = useState<ReferenceImageSlot[]>(INITIAL_REF_SLOTS);
  const [multiViewBusy, setMultiViewBusy] = useState(false);
  const [multiViewNote, setMultiViewNote] = useState<string | null>(null);
  const [selectedLibraryPose, setSelectedLibraryPose] = useState<PoseLibraryRecord | null>(null);
  const [rasterSettings, setRasterSettings] = useState<RasterRenderSettings>(() =>
    validateRasterSettings({
      style: 'colored_cel',
      resolutionWidth: 1024,
      resolutionHeight: 1024,
      selectedViews: ['perspective', 'front', 'side', 'back'],
    })
  );
  const [rasterSceneAssets, setRasterSceneAssets] = useState<RasterSceneAssets>({
    backgroundImages: [],
    propImages: [],
    referenceImages: [],
  });
  const [rasterOutputs, setRasterOutputs] = useState<RasterOutputRecord[]>(() =>
    loadLocalRastersList<RasterOutputRecord>()
  );
  const [activeRasterId, setActiveRasterId] = useState<string | null>(() => {
    const existing = loadLocalRastersList<RasterOutputRecord>();
    return existing[0]?.id ?? null;
  });
  const [rasterBusy, setRasterBusy] = useState(false);
  const rasterAbortRef = useRef<AbortController | null>(null);
  const [requestedPoseSubTab, setRequestedPoseSubTab] = useState<{
    tab: 'skeleton' | 'reference' | 'raster';
    seq: number;
  } | null>(null);

  // Scene appearance, props, environments
  const [materialSettings, setMaterialSettings] = useState<MaterialAppearanceSettings>({
    mode: 'original',
    tintHex: '#ffffff',
    roughness: 0.55,
    metalness: 0.08,
    showSkeleton: false,
  });
  const [propsList, setPropsList] = useState<PropAttachment[]>([]);
  const [environmentBg, setEnvironmentBg] = useState<EnvironmentBackground | null>(null);

  // Render/video export progress
  const [renderDurationSec, setRenderDurationSec] = useState(12);
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [renderNote, setRenderNote] = useState<string | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);

  // Server lists
  const [serverProjects, setServerProjects] = useState<PortableProjectManifest[]>([]);
  const [serverCharacters, setServerCharacters] = useState<PortableCharacterManifest[]>([]);

  // Stage Character modal & Persistent Rigged Character Library State
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [savedRiggedCharacters, setSavedRiggedCharacters] = useState<PersistedRiggedCharacterDoc[]>([]);
  const [saveCharacterProgress, setSaveCharacterProgress] = useState<number | null>(null);
  const [saveCharacterError, setSaveCharacterError] = useState<string | null>(null);

  // Horizontal & vertical resizable / collapsible panels around the 3D Space World
  const [panelLayout, setPanelLayout] = useState<PanelLayoutState>(loadSavedPanelLayout);
  const [isMdUp, setIsMdUp] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true
  );
  const [isLgUp, setIsLgUp] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  );

  const strings = getStudioStrings(lang);

  useEffect(() => {
    savePanelLayout(panelLayout);
  }, [panelLayout]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mqMd = window.matchMedia('(min-width: 768px)');
    const mqLg = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      setIsMdUp(mqMd.matches);
      setIsLgUp(mqLg.matches);
    };
    sync();
    mqMd.addEventListener('change', sync);
    mqLg.addEventListener('change', sync);
    return () => {
      mqMd.removeEventListener('change', sync);
      mqLg.removeEventListener('change', sync);
    };
  }, []);

  // Sync theme attribute on root element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Restore local draft & fetch server catalogs cleanly on mount
  useEffect(() => {
    const draft = loadProjectDraftLocally();
    if (draft) {
      const clean = sanitizeProjectManifest(draft);
      setProjectId(clean.id);
      setProjectName(clean.name);
      setLang(clean.language);
      setTheme(clean.theme);
      setTimelineMode(clean.timelineMode);
      setTimelineDurationSec(clean.timelineDurationSec);
      setPlaybackSpeed(clean.playbackSpeed);
      setLoopPlayback(clean.loopPlayback);
      setPoseKeyframes(clean.poseKeyframes);
      setSavedPoses(clean.savedPoses);
      setPropsList(clean.props);
      setMaterialSettings(clean.material);
      if (Object.keys(clean.activeBoneRotations).length > 0) {
        setManualBoneRotations(clean.activeBoneRotations);
      }
    }
    void listServerProjects().then(setServerProjects).catch(() => undefined);
    void listServerCharacters().then(setServerCharacters).catch(() => undefined);
    void listPersistedRiggedCharacters().then(setSavedRiggedCharacters).catch(() => undefined);
  }, []);

  // Save draft locally whenever key project state changes
  const buildCurrentManifest = useCallback((): PortableProjectManifest => {
    return sanitizeProjectManifest({
      version: 2,
      id: projectId,
      name: projectName,
      language: lang,
      theme,
      updatedAt: new Date().toISOString(),
      characterId: characterManifest.savedRecordId || characterManifest.id,
      timelineMode,
      timelineDurationSec,
      playbackSpeed,
      loopPlayback,
      clips: timelineClips,
      poseKeyframes,
      savedPoses,
      activeBoneRotations: manualBoneRotations,
      props: propsList,
      environmentId: environmentBg?.id || null,
      material: materialSettings,
      camera: {
        preset: 'perspective',
        position: { x: 0.85, y: 1.35, z: 3.15 },
        target: { x: 0, y: 0.92, z: 0 },
        fov: 38,
      },
    });
  }, [
    projectId,
    projectName,
    lang,
    theme,
    characterManifest,
    timelineMode,
    timelineDurationSec,
    playbackSpeed,
    loopPlayback,
    timelineClips,
    poseKeyframes,
    savedPoses,
    manualBoneRotations,
    propsList,
    environmentBg,
    materialSettings,
  ]);

  useEffect(() => {
    saveProjectDraftLocally(buildCurrentManifest());
  }, [buildCurrentManifest]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = ((now - last) / 1000) * playbackSpeed;
      last = now;
      setCurrentTimeSec((prev) => {
        const next = prev + dt;
        if (next >= timelineDurationSec) {
          if (loopPlayback) return 0;
          setIsPlaying(false);
          return timelineDurationSec;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, playbackSpeed, timelineDurationSec, loopPlayback]);

  // Effective bone rotations: either sampled from Pose Keyframes during pose_keyframes mode, or manualBoneRotations
  const effectiveBoneRotations = useMemo<BoneRotationMap>(() => {
    if (
      timelineMode === 'pose_keyframes' &&
      poseKeyframes.length > 0 &&
      !driverState.liveFollow &&
      (isPlaying || currentTimeSec > 0)
    ) {
      return samplePoseKeyframesAtTime(poseKeyframes, currentTimeSec);
    }
    return manualBoneRotations;
  }, [
    timelineMode,
    poseKeyframes,
    driverState.liveFollow,
    isPlaying,
    currentTimeSec,
    manualBoneRotations,
  ]);

  const commitManualRotations = useCallback((next: BoneRotationMap) => {
    setPoseUndoStack((prev) => [...prev.slice(-19), manualBoneRotations]);
    setManualBoneRotations(next);
    setTimelineMode('pose_keyframes');
    setIsPlaying(false);
  }, [manualBoneRotations]);

  // Live follow retargeting from Mannequin Driver when enabled
  useEffect(() => {
    if (!driverState.liveFollow) return;
    const report = retargetPoseAcrossRigs(
      mannequinRefRig.root,
      driverState.driverBoneRotations,
      subjectRoot,
      restPose,
      mannequinRestPose,
      driverState.driverBonePositions
    );
    setManualBoneRotations(report.rotations);
    setManualBonePositions(report.positions);
    setFingerControls(driverState.driverFingerControls);
    setTimelineMode('pose_keyframes');
    setIsPlaying(false);
    if (
      Object.keys(driverState.driverBoneRotations).length > 0 ||
      Object.keys(driverState.driverBonePositions || {}).length > 0
    ) {
      setStatusBanner(`Live Follow synced (${report.mappedCount} mapped bones)`);
    }
  }, [driverState, mannequinRefRig.root, mannequinRestPose, subjectRoot, restPose]);

  // Character Upload & Production Handlers (strictly rigged-character-only)
  const stageValidatedCharacterBundle = async (
    primaryFile: File,
    companions: File[],
    extraClipFiles: File[] = []
  ): Promise<PortableCharacterManifest> => {
    const loaded = await loadCharacterBundleFromFiles(primaryFile, companions);
    const diag = inspectObject3D(loaded.root, loaded.clips);
    const rigCheck = validateRiggedCharacterOnly(diag, loaded.format);
    if (!rigCheck.valid) {
      const reason = (rigCheck as { valid: false; reason: string }).reason;
      setStatusBanner(`Rejected ${primaryFile.name}: only rigged characters are valid.`);
      throw new Error(reason);
    }

    // Load any additional animation clip files queued in Stage modal
    const extraClips: THREE.AnimationClip[] = [];
    for (const cf of extraClipFiles) {
      const parsed = await loadAnimationClipsFromFile(cf);
      extraClips.push(...parsed);
    }
    const allClips = [...loaded.clips, ...extraClips];

    // If user uploaded a textures/mats folder and any mesh lacks a diffuse map or resources missed, auto-apply PBR maps
    const folderImageFiles = companions.filter((f) => inferTextureChannelFromName(f.name) !== null);
    let anyMeshMissingMap = false;
    loaded.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.map) anyMeshMissingMap = true;
      }
    });

    let appliedBindings: PbrTextureSlotBinding[] = [];
    if (folderImageFiles.length > 0 && (anyMeshMissingMap || loaded.missingResources.length > 0)) {
      const auto = buildAutoPbrBindingsFromFolderFiles(folderImageFiles);
      const bindRes = await applyPbrTextureBindings(loaded.root, materialCacheRef.current, auto.bindings);
      appliedBindings = auto.bindings;
      if (bindRes.warnings.length > 0) {
        diag.warnings.push(...bindRes.warnings);
      }
      setTimeout(() => auto.revokeUrls(), 4000);
    }

    const clipSettings = allClips.map((c, idx) =>
      evaluateClipCompatibility(
        c,
        loaded.root,
        idx < loaded.clips.length ? 'embedded' : 'uploaded_clip'
      )
    );

    setSubjectRoot(loaded.root);
    setRestPose(captureRestPose(loaded.root));
    setClips(allClips);
    const firstCompat = clipSettings.find((c) => c.compatible)?.sourceName || null;
    setActiveClipName(firstCompat);
    setTimelineMode(firstCompat ? 'clips' : 'pose_keyframes');
    setManualBoneRotations({});
    setManualBonePositions({});
    setPoseUndoStack([]);
    setSelectedBoneName(diag.boneNames[0] || null);
    setTimelineClips(
      clipSettings
        .filter((c) => c.compatible)
        .map((c, idx) => ({
          id: `tc-${Date.now()}-${idx}`,
          sourceClipName: c.sourceName,
          label: c.label,
          startSec: idx * Math.max(1, c.durationSec),
          durationSec: Math.max(1, c.durationSec),
          speed: c.speed,
          loop: c.loop,
          sourceKind: 'embedded',
        }))
    );

    if (loaded.missingResources.length > 0 && appliedBindings.length === 0) {
      diag.warnings.push(`Missing companion resources: ${loaded.missingResources.join(', ')}`);
    }
    diag.warnings.push(...loaded.warnings);

    const nextManifest: PortableCharacterManifest = {
      id: `char-${Date.now()}`,
      name: primaryFile.name.replace(/\.[^.]+$/, ''),
      format: loaded.format,
      isBuiltInDemo: false,
      persistenceScope: 'local_browser',
      primaryFileName: primaryFile.name,
      primaryFileSizeBytes: primaryFile.size,
      companionFiles: companions.map((f, i) => ({
        id: `cmp-${i}`,
        name: f.name,
        role: f.type.startsWith('image/') || inferTextureChannelFromName(f.name) ? 'texture' : 'companion',
        sizeBytes: f.size,
        mimeType: f.type || 'application/octet-stream',
      })),
      textureBindings: appliedBindings,
      clipSettings,
      diagnostics: diag,
    };

    setCharacterManifest(nextManifest);
    setStatusBanner(
      `Staged rigged character "${nextManifest.name}" (${diag.boneCount} bones, ${allClips.length} clips)`
    );
    return nextManifest;
  };

  const handleUploadCharacterBundle = async (primaryFile: File, companions: File[]) => {
    await stageValidatedCharacterBundle(primaryFile, companions, []);
  };

  const handleSaveCharacterForever = async () => {
    setSaveCharacterError(null);
    setSaveCharacterProgress(5);
    try {
      const glbBytes = await exportCharacterToGlb(subjectRoot, clips);
      const saved = await savePersistedRiggedCharacter({
        manifest: characterManifest,
        glbBytes,
        onProgress: setSaveCharacterProgress,
      });
      setCharacterManifest((prev) => ({
        ...prev,
        savedRecordId: saved.id,
        lastSavedAt: new Date().toISOString(),
      }));
      setSavedRiggedCharacters(await listPersistedRiggedCharacters());
      setStatusBanner(`Saved "${saved.name}" forever`);
    } catch (err) {
      const msg = (err as Error).message;
      setSaveCharacterError(msg);
      throw err;
    } finally {
      setSaveCharacterProgress(null);
    }
  };

  const handleLoadSavedCharacter = async (docItem: PersistedRiggedCharacterDoc) => {
    setSaveCharacterError(null);
    try {
      const { bytes, fileName, metadata } = await loadPersistedRiggedCharacterGlb(docItem);
      const glbFile = new File([new Uint8Array(bytes)], fileName, {
        type: 'model/gltf-binary',
      });
      const loadedManifest = await stageValidatedCharacterBundle(glbFile, [], []);
      setCharacterManifest({
        ...loadedManifest,
        name: metadata.name,
        format: metadata.sourceFormat,
        savedRecordId: metadata.id,
      });
      setStatusBanner(`Loaded "${metadata.name}"`);
    } catch (err) {
      setSaveCharacterError((err as Error).message);
    }
  };

  const handleDeleteSavedCharacter = async (charId: string) => {
    setSaveCharacterError(null);
    try {
      await deletePersistedRiggedCharacter(charId);
      setSavedRiggedCharacters(await listPersistedRiggedCharacters());
      setStatusBanner('Deleted saved character');
    } catch (err) {
      setSaveCharacterError((err as Error).message);
    }
  };

  const handleUploadAnimationClips = async (files: File[]) => {
    const newClips: THREE.AnimationClip[] = [];
    for (const f of files) {
      const parsed = await loadAnimationClipsFromFile(f);
      newClips.push(...parsed);
    }
    const combinedClips = [...clips, ...newClips];
    setClips(combinedClips);

    const newSettings: CharacterClipSetting[] = newClips.map((c) =>
      evaluateClipCompatibility(c, subjectRoot, 'uploaded_clip')
    );
    setCharacterManifest((prev) => ({
      ...prev,
      clipSettings: [...prev.clipSettings, ...newSettings],
    }));

    const firstValid = newSettings.find((c) => c.compatible);
    if (firstValid) {
      setActiveClipName(firstValid.sourceName);
      setTimelineMode('clips');
      setTimelineClips((prev) => [
        ...prev,
        ...newSettings
          .filter((c) => c.compatible)
          .map((c) => ({
            id: `tc-${Date.now()}-${c.id}`,
            sourceClipName: c.sourceName,
            label: c.label,
            startSec: 0,
            durationSec: Math.max(1, c.durationSec),
            speed: c.speed,
            loop: c.loop,
            sourceKind: 'embedded' as const,
          })),
      ]);
      setStatusBanner(`Added ${newClips.length} clip(s) (${firstValid.boundTrackCount} bound tracks)`);
    } else {
      setStatusBanner('Uploaded clip tracks did not match this skeleton bone hierarchy.');
    }
  };

  const handleLoadDemoCharacter = () => {
    const fresh = createDemoSkinnedCharacter('demo');
    const diag = inspectObject3D(fresh.root, fresh.clips);
    setSubjectRoot(fresh.root);
    setRestPose(captureRestPose(fresh.root));
    setClips(fresh.clips);
    setActiveClipName(fresh.clips[0]?.name || null);
    setManualBoneRotations({});
    setSelectedBoneName('LeftForeArm');
    setTimelineMode('clips');
    setCharacterManifest({
      id: 'rapuso-demo-rig',
      name: 'RAPUSO Bundled Demo Humanoid',
      format: 'demo',
      isBuiltInDemo: true,
      persistenceScope: 'bundled',
      primaryFileName: 'bundled_demo_humanoid.procedural',
      primaryFileSizeBytes: 0,
      companionFiles: [],
      textureBindings: [],
      clipSettings: fresh.clips.map((c) => evaluateClipCompatibility(c, fresh.root, 'preset')),
      diagnostics: diag,
    });
    setStatusBanner('Restored bundled skinned demo humanoid');
  };

  const handleAddTextureBinding = async (binding: PbrTextureSlotBinding) => {
    const next = [...characterManifest.textureBindings, binding];
    const res = await applyPbrTextureBindings(subjectRoot, materialCacheRef.current, next);
    setCharacterManifest((prev) => ({
      ...prev,
      textureBindings: next,
      diagnostics: {
        ...prev.diagnostics,
        warnings: [...prev.diagnostics.warnings, ...res.warnings].slice(-8),
      },
    }));
    setStatusBanner(`Applied ${binding.channel} map (${res.appliedCount} slot matches)`);
  };

  const handleClearTextureBindings = async () => {
    await applyPbrTextureBindings(subjectRoot, materialCacheRef.current, []);
    setCharacterManifest((prev) => ({ ...prev, textureBindings: [] }));
    setStatusBanner('Restored original imported materials & maps');
  };

  // Helper to sync Multi-View reference slots directly onto the built-in 2D Ref & Driver mannequin
  const syncMannequinFromReferenceSlots = useCallback(
    (slotsToSolve: ReferenceImageSlot[], actionLabel?: string) => {
      const hasAnyLandmarks = slotsToSolve.some((s) => s.landmarks.length > 0);
      if (!hasAnyLandmarks) return;
      const solved = solveMultiViewPoseForMannequin(mannequinRefRig.root, slotsToSolve);
      setDriverState((prev) => ({
        ...prev,
        driverBoneRotations: solved.rotations,
        lastSyncedAt: new Date().toISOString(),
      }));
      const note =
        solved.notes[0] ||
        `${actionLabel || 'Synced'} Mannequin Driver from reference landmarks.`;
      setMultiViewNote(note);
      setStatusBanner(note);
    },
    [mannequinRefRig.root]
  );

  // Raster Scene Images Upload Helpers
  const handleAddRasterSceneImages = useCallback(
    (kind: keyof RasterSceneAssets, files: FileList | File[]) => {
      const list = Array.from(files);
      list.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const item: RasterImageAsset = {
            id: `rsa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            dataUrl: String(reader.result),
          };
          setRasterSceneAssets((prev) => ({
            ...prev,
            [kind]: [...prev[kind], item],
          }));
        };
        reader.readAsDataURL(file);
      });
    },
    []
  );

  // Pose Library -> Change Pose integration
  const handleChangePoseFromLibrary = async (pose: PoseLibraryRecord) => {
    setSelectedLibraryPose(pose);
    setDriverState((prev) => ({ ...prev, liveFollow: false }));
    setWorkspace('pose');
    setStatusBanner(`Detecting pose from "${pose.name}"…`);

    const det = await detectStillImagePose(pose.imageUrl, 0);
    const nextSlots: ReferenceImageSlot[] = referenceSlots.map((s) =>
      s.view === 'front'
        ? {
            view: 'front',
            imageUrl: pose.imageUrl,
            imageName: pose.name,
            sourcePoseLibraryId: pose.id,
            landmarks: det.landmarks,
            confidenceMean: det.confidenceMean,
            missingJoints: det.missingJoints,
            samePoseConfirmed: true,
            detectionSource: det.detectionSource,
            statusNote: det.statusNote,
          }
        : s
    );
    setReferenceSlots(nextSlots);
    syncMannequinFromReferenceSlots(nextSlots, pose.name);

    const solved = solveReferenceSlotsToBoneRotations(subjectRoot, nextSlots, 'front');
    commitManualRotations(solved.rotations);
    setStatusBanner(
      `Applied "${pose.name}" (${solved.mappedJointsCount} joints · ${Math.round(solved.confidenceMean * 100)}% vis)`
    );
  };

  // Raster Capture
  const handleRunRasterCapture = async (
    views: CameraPreset[],
    overrideSettings?: RasterRenderSettings
  ) => {
    if (!viewportRef.current) return;
    rasterAbortRef.current?.abort();
    const ctrl = new AbortController();
    rasterAbortRef.current = ctrl;
    setRasterBusy(true);
    try {
      const results = await viewportRef.current.captureRasterViews(
        views,
        overrideSettings ?? rasterSettings,
        projectName,
        ctrl.signal,
        rasterSceneAssets
      );
      setRasterOutputs((prev) => {
        const capturedViews = new Set(results.map((r) => r.view));
        const remaining = prev.filter((item) => !capturedViews.has(item.view));
        const merged = [...results, ...remaining].slice(0, MAX_RASTER_TAKES_IN_PROJECT);
        saveLocalRastersList(merged);
        return merged;
      });
      if (results[0]) {
        setActiveRasterId(results[0].id);
      }
      setStatusBanner(`Captured ${results.length} raster view(s)`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setStatusBanner(`Raster failed: ${(err as Error).message}`);
      }
    } finally {
      setRasterBusy(false);
    }
  };

  const handleUpdateRasterPlacement = (
    id: string,
    patch: { foregroundOffsetX?: number; foregroundOffsetY?: number; foregroundScale?: number },
    applyToAllViews = false
  ) => {
    setRasterOutputs((prev) => {
      const next = prev.map((rec) => {
        if (!applyToAllViews && rec.id !== id) return rec;
        return {
          ...rec,
          foregroundOffsetX:
            patch.foregroundOffsetX !== undefined
              ? Math.max(-1, Math.min(1, patch.foregroundOffsetX))
              : rec.foregroundOffsetX ?? 0,
          foregroundOffsetY:
            patch.foregroundOffsetY !== undefined
              ? Math.max(-1, Math.min(1, patch.foregroundOffsetY))
              : rec.foregroundOffsetY ?? 0,
          foregroundScale:
            patch.foregroundScale !== undefined
              ? Math.max(0.35, Math.min(2.5, patch.foregroundScale))
              : rec.foregroundScale ?? 1,
        };
      });
      saveLocalRastersList(next);
      return next;
    });
  };

  const handleDownloadRasterZip = async (rec: RasterOutputRecord) => {
    const [combinedUrl, lineUrl, colorUrl, shadowUrl] = await Promise.all([
      composeRasterRecordExportDataUrl(rec, 'combined'),
      rec.linePassDataUrl ? composeRasterRecordExportDataUrl(rec, 'line') : Promise.resolve(undefined),
      rec.colorPassDataUrl ? composeRasterRecordExportDataUrl(rec, 'color') : Promise.resolve(undefined),
      rec.shadowPassDataUrl ? composeRasterRecordExportDataUrl(rec, 'shadow') : Promise.resolve(undefined),
    ]);

    const files: Record<string, Uint8Array | string> = {
      'manifest.json': JSON.stringify(
        {
          studio: 'RAPUSO (らぷそ) by LIGHTHOUSE 橋',
          view: rec.view,
          width: rec.width,
          height: rec.height,
          createdAt: rec.createdAt,
          style: rasterSettings.style,
          camera: {
            zoom: rasterSettings.cameraZoom,
            yawDeg: rasterSettings.cameraOrbitYawDeg,
            pitchDeg: rasterSettings.cameraOrbitPitchDeg,
            rollDeg: rasterSettings.cameraRollDeg,
            panY: rasterSettings.cameraPanY,
          },
          characterPlacement: {
            offsetX: rec.foregroundOffsetX ?? 0,
            offsetY: rec.foregroundOffsetY ?? 0,
            scale: rec.foregroundScale ?? 1,
          },
          backgroundsCount: rasterSceneAssets.backgroundImages.length,
          propsCount: rasterSceneAssets.propImages.length,
          referenceImagesCount: rasterSceneAssets.referenceImages.length,
        },
        null,
        2
      ),
      [`${rec.view}_combined.png`]: dataUrlToUint8Array(combinedUrl),
    };
    if (lineUrl) files[`${rec.view}_line.png`] = dataUrlToUint8Array(lineUrl);
    if (colorUrl) files[`${rec.view}_color.png`] = dataUrlToUint8Array(colorUrl);
    if (shadowUrl) files[`${rec.view}_shadow.png`] = dataUrlToUint8Array(shadowUrl);
    if (rec.foregroundDataUrl) files[`${rec.view}_foreground_only.png`] = dataUrlToUint8Array(rec.foregroundDataUrl);
    if (rec.backgroundDataUrl) files[`${rec.view}_background_fixed.png`] = dataUrlToUint8Array(rec.backgroundDataUrl);
    rasterSceneAssets.referenceImages.forEach((refImg, idx) => {
      const safeName = refImg.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      files[`references/${idx + 1}_${safeName}`] = dataUrlToUint8Array(refImg.dataUrl);
    });

    const zipBytes = packFilesToZip(files);
    triggerBlobDownload(new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' }), `rapuso_${rec.view}_passes.zip`);
  };

  const navItems: Array<{ id: WorkspaceId; icon: React.ReactNode }> = [
    { id: 'animation', icon: <Film className="h-4 w-4" /> },
    { id: 'characters', icon: <Layers className="h-4 w-4" /> },
    { id: 'pose', icon: <PersonStanding className="h-4 w-4" /> },
    { id: 'poseLibrary', icon: <Image className="h-4 w-4" /> },
    { id: 'assets', icon: <FolderKanban className="h-4 w-4" /> },
  ];

  const shows3DViewport = workspace === 'animation' || workspace === 'characters' || workspace === 'pose';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--surface-0)] text-[var(--text-primary)]">
      <StudioHeader
        lang={lang}
        theme={theme}
        strings={strings}
        projectName={projectName}
        onProjectNameChange={setProjectName}
        onToggleLang={() => setLang((l) => (l === 'en' ? 'ja' : 'en'))}
        onToggleTheme={() => setTheme((t) => (t === 'indigo' ? 'graphite' : 'indigo'))}
        onOpenGuide={() => setGuideOpen(true)}
        savingProject={savingProject}
        statusBanner={statusBanner}
        onSaveProjectServer={async () => {
          setSavingProject(true);
          try {
            const saved = await saveServerProject(buildCurrentManifest());
            setProjectId(saved.id);
            setServerProjects(await listServerProjects());
            setStatusBanner(`Saved project ${saved.name} to server`);
          } catch (err) {
            setStatusBanner((err as Error).message);
          } finally {
            setSavingProject(false);
          }
        }}
        onExportJson={() => {
          const manifest = buildCurrentManifest();
          triggerBlobDownload(
            new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
            `${manifest.name.replace(/\s+/g, '_')}.rapuso.json`
          );
        }}
        onImportJsonFile={async (file) => {
          const text = await file.text();
          const imported = sanitizeProjectManifest(JSON.parse(text));
          setProjectId(imported.id);
          setProjectName(imported.name);
          setLang(imported.language);
          setTheme(imported.theme);
          setTimelineMode(imported.timelineMode);
          setTimelineDurationSec(imported.timelineDurationSec);
          setPoseKeyframes(imported.poseKeyframes);
          setSavedPoses(imported.savedPoses);
          setManualBoneRotations(imported.activeBoneRotations);
          setPropsList(imported.props);
          setMaterialSettings(imported.material);
          setStatusBanner(`Imported project "${imported.name}"`);
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left Navigation Rail (desktop vertical & resizable, mobile horizontal strip) */}
        {(!isMdUp || !panelLayout.navCollapsed) && (
          <nav
            aria-label="Studio Workspaces"
            data-testid="studio-left-nav"
            style={isMdUp ? { width: `${panelLayout.navWidthPx}px` } : undefined}
            className="flex shrink-0 flex-row overflow-x-auto border-b border-white/10 bg-[var(--surface-1)] md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-b-0"
          >
            {ACTIVE_WORKSPACE_IDS.map((id) => {
              const meta = navItems.find((n) => n.id === id)!;
              const active = workspace === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setWorkspace(id)}
                  data-testid={`nav-${id}`}
                  className={`flex shrink-0 items-center gap-2.5 border-b-2 px-3 py-2.5 text-left text-xs font-medium transition-colors md:border-b-0 md:border-r-2 ${
                    active
                      ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/12 text-[var(--accent-sakura-strong)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
                  }`}
                >
                  {meta.icon}
                  <span className="truncate whitespace-nowrap">{strings.nav[id]}</span>
                </button>
              );
            })}

            <div className="hidden md:mt-auto md:block border-t border-white/10 p-3 text-[10px] leading-relaxed text-[var(--text-muted)]">
              <div className="font-semibold text-[var(--text-secondary)]">{strings.tagline}</div>
              <div className="mt-1 font-mono-tech">
                {characterManifest.diagnostics.boneCount} bones ·{' '}
                {characterManifest.diagnostics.hasSkinWeights ? 'Skinned' : 'Static'}
              </div>
            </div>
          </nav>
        )}

        {/* Horizontal Resize + Collapse/Expand Splitter for Left Navigation Rail (desktop/tablet md+) */}
        {isMdUp && (
          <PanelSplitter
            axis="horizontal-drag"
            collapseDirection="left"
            collapsed={panelLayout.navCollapsed}
            onToggleCollapse={() =>
              setPanelLayout((prev) => ({ ...prev, navCollapsed: !prev.navCollapsed }))
            }
            onDragDelta={(dx) =>
              setPanelLayout((prev) =>
                clampPanelLayout({ ...prev, navWidthPx: prev.navWidthPx + dx })
              )
            }
            onDoubleClickReset={() =>
              setPanelLayout((prev) => ({
                ...prev,
                navWidthPx: DEFAULT_PANEL_LAYOUT.navWidthPx,
                navCollapsed: false,
              }))
            }
            label="Navigation Panel"
            testId="splitter-nav"
            toggleTestId="toggle-nav-panel-btn"
          />
        )}

        {/* Main Workspace Stage */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {shows3DViewport ? (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              {/* Central 3D Viewport + Vertical Splitter + Bottom Timeline (or Minimized Dock) */}
              {panelLayout.stageCollapsed ? (
                <div
                  data-testid="stage-3d-minimized-bar"
                  className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[var(--surface-1)] px-3 lg:h-full lg:w-11 lg:flex-col lg:border-b-0 lg:border-r lg:px-1.5 lg:py-3"
                >
                  <button
                    type="button"
                    onClick={() => setPanelLayout((prev) => toggleStageMinimizeLayout(prev))}
                    data-testid="restore-stage-3d-btn"
                    aria-label="Restore Pose Keyframes 3D World"
                    title="Restore Pose Keyframes 3D World"
                    className="inline-flex items-center gap-1 rounded border border-[var(--accent-mint)]/50 bg-[var(--accent-mint)]/15 px-2 py-1 text-[10px] font-semibold text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/25 lg:px-1.5 lg:py-1.5"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span className="lg:hidden">Restore 3D</span>
                  </button>

                  <span className="truncate font-mono-tech text-[10px] text-[var(--text-muted)] lg:[writing-mode:vertical-rl] lg:rotate-180">
                    Pose Keyframes 3D · Minimized
                  </span>

                  <button
                    type="button"
                    onClick={() => setPanelLayout((prev) => toggleFocus3DLayout(prev))}
                    data-testid="maximize-stage-3d-btn"
                    aria-label="Maximize Pose Keyframes 3D World"
                    title="Maximize Pose Keyframes 3D World"
                    className="inline-flex items-center gap-1 rounded border border-white/15 bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent-sakura)]/50 hover:text-white lg:px-1.5 lg:py-1.5"
                  >
                    <Maximize2 className="h-3 w-3 text-[var(--accent-sakura)]" />
                    <span className="lg:hidden">Max 3D</span>
                  </button>
                </div>
              ) : (
                <div className="flex min-h-[200px] min-w-0 flex-1 flex-col">
                  <div className="relative flex-1 min-h-0">
                    <Viewport3D
                      ref={viewportRef}
                      subjectRoot={subjectRoot}
                      restPose={restPose}
                      clips={clips}
                      activeClipName={activeClipName}
                      timelineMode={timelineMode}
                      currentTimeSec={currentTimeSec}
                      isPlaying={isPlaying}
                      boneRotations={effectiveBoneRotations}
                      bonePositions={timelineMode === 'pose_keyframes' ? manualBonePositions : undefined}
                      fingerControls={fingerControls}
                      selectedBoneName={selectedBoneName}
                      showGizmoRings={workspace === 'pose' && showGizmoRings}
                      materialSettings={materialSettings}
                      propsList={propsList}
                      environmentBg={environmentBg}
                      onRotateBoneDelta={(boneName, delta) => {
                        const prev = manualBoneRotations[boneName] || { x: 0, y: 0, z: 0 };
                        commitManualRotations({
                          ...manualBoneRotations,
                          [boneName]: {
                            x: prev.x + delta.x,
                            y: prev.y + delta.y,
                            z: prev.z + delta.z,
                          },
                        });
                      }}
                    />

                    {/* Subtle corner viewport readout */}
                    <div className="pointer-events-none absolute left-2.5 top-2 flex max-w-[calc(100%-290px)] items-center gap-1.5 truncate rounded bg-[#0D0F18]/75 px-2 py-0.5 text-[11px] font-mono-tech text-[var(--text-secondary)]">
                      <span className="truncate">{characterManifest.name}</span>
                      <span>·</span>
                      <span className="shrink-0 text-[var(--accent-mint)]">
                        {timelineMode === 'pose_keyframes'
                          ? 'Pose Keyframes'
                          : activeClipName || 'Rest Pose'}
                      </span>
                    </div>

                    {/* Quick Stage Character, Minimize 3D & Maximize 3D Space World triggers */}
                    <div className="absolute right-2.5 top-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPanelLayout((prev) => toggleStageMinimizeLayout(prev))}
                        data-testid="minimize-stage-3d-btn"
                        aria-label="Minimize Pose Keyframes 3D World"
                        title="Minimize Pose Keyframes 3D World (expands Mannequin Driver)"
                        className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-[#101425]/90 px-2 py-1 text-[11px] font-medium text-[#cdd6f4] shadow-md backdrop-blur hover:border-[var(--accent-sakura)]/60 hover:text-white"
                      >
                        <Minimize2 className="h-3.5 w-3.5 text-[var(--accent-sakura)]" />
                        <span className="hidden sm:inline">Minimize</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPanelLayout((prev) => toggleFocus3DLayout(prev))}
                        data-testid="toggle-focus-3d-btn"
                        aria-label={
                          areAllSurroundingPanelsCollapsed(panelLayout)
                            ? 'Restore Studio Panels'
                            : 'Maximize Pose Keyframes 3D World'
                        }
                        title={
                          areAllSurroundingPanelsCollapsed(panelLayout)
                            ? 'Restore Studio Panels'
                            : 'Maximize 3D Space World'
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-[#101425]/90 px-2 py-1 text-[11px] font-medium text-[#cdd6f4] shadow-md backdrop-blur hover:border-[var(--accent-mint)]/60 hover:text-white"
                      >
                        {areAllSurroundingPanelsCollapsed(panelLayout) ? (
                          <>
                            <Minimize2 className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
                            <span className="hidden sm:inline">Restore</span>
                          </>
                        ) : (
                          <>
                            <Maximize2 className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
                            <span className="hidden sm:inline">3D Focus</span>
                          </>
                        )}
                      </button>

                      {(workspace === 'animation' || workspace === 'characters') && (
                        <button
                          type="button"
                          onClick={() => setStageModalOpen(true)}
                          data-testid="viewport-stage-character-btn"
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#F4B3C2]/55 bg-[#101425]/90 px-2.5 py-1 text-[11px] font-semibold text-[#F4B3C2] shadow-md backdrop-blur hover:bg-[#19203a]"
                        >
                          <Bone className="h-3.5 w-3.5" />
                          <span>{lang === 'ja' ? 'キャラクター読込' : 'Stage Character'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Vertical Resize + Collapse/Expand Splitter for Bottom Timeline */}
                  <PanelSplitter
                    axis="vertical-drag"
                    collapseDirection="down"
                    collapsed={panelLayout.timelineCollapsed}
                    onToggleCollapse={() =>
                      setPanelLayout((prev) => ({
                        ...prev,
                        timelineCollapsed: !prev.timelineCollapsed,
                      }))
                    }
                    onDragDelta={(dy) =>
                      setPanelLayout((prev) =>
                        clampPanelLayout({
                          ...prev,
                          timelineHeightPx: prev.timelineHeightPx - dy,
                        })
                      )
                    }
                    onDoubleClickReset={() =>
                      setPanelLayout((prev) => ({
                        ...prev,
                        timelineHeightPx: PANEL_LIMITS.timelineH.defaultPx,
                        timelineCollapsed: false,
                      }))
                    }
                    label="Timeline Panel"
                    testId="splitter-timeline"
                    toggleTestId="toggle-timeline-panel-btn"
                  />

                  {!panelLayout.timelineCollapsed && (
                    <div
                      data-testid="timeline-panel-container"
                      style={{ height: `${panelLayout.timelineHeightPx}px` }}
                      className="shrink-0 overflow-hidden"
                    >
                      <TimelineBar
                        lang={lang}
                        strings={strings}
                        mode={timelineMode}
                        onChangeMode={(m) => {
                          setTimelineMode(m);
                          setIsPlaying(false);
                        }}
                        durationSec={timelineDurationSec}
                        onChangeDurationSec={(sec) => setTimelineDurationSec(clampTimelineDuration(sec))}
                        currentTimeSec={currentTimeSec}
                        onSeek={(t) => {
                          setIsPlaying(false);
                          setCurrentTimeSec(t);
                        }}
                        isPlaying={isPlaying}
                        onTogglePlay={() => setIsPlaying((p) => !p)}
                        loop={loopPlayback}
                        onToggleLoop={() => setLoopPlayback((l) => !l)}
                        speed={playbackSpeed}
                        onChangeSpeed={setPlaybackSpeed}
                        clips={timelineClips}
                        activeClipName={activeClipName}
                        onSelectClipName={(name) => {
                          setActiveClipName(name);
                          setTimelineMode('clips');
                        }}
                        keyframes={poseKeyframes}
                        onAddKeyframeAtCurrentTime={() => {
                          const kf: PoseKeyframe = {
                            id: `kf-${Date.now()}`,
                            timeSec: Number(currentTimeSec.toFixed(2)),
                            label: `Key ${poseKeyframes.length + 1}`,
                            boneRotations: { ...manualBoneRotations },
                          };
                          setPoseKeyframes((prev) => [...prev, kf].sort((a, b) => a.timeSec - b.timeSec));
                          setStatusBanner(`Added keyframe at ${kf.timeSec}s`);
                        }}
                        onRemoveKeyframe={(id) =>
                          setPoseKeyframes((prev) => prev.filter((k) => k.id !== id))
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Horizontal (lg+) or Vertical (< lg) Resize + Collapse/Expand Splitter for Right Inspector */}
              {!panelLayout.stageCollapsed && (
                <PanelSplitter
                  axis={isLgUp ? 'horizontal-drag' : 'vertical-drag'}
                  collapseDirection={isLgUp ? 'right' : 'down'}
                  collapsed={panelLayout.inspectorCollapsed}
                  onToggleCollapse={() =>
                    setPanelLayout((prev) => ({
                      ...prev,
                      inspectorCollapsed: !prev.inspectorCollapsed,
                    }))
                  }
                  onDragDelta={(delta) =>
                    setPanelLayout((prev) =>
                      isLgUp
                        ? clampPanelLayout({
                            ...prev,
                            inspectorWidthPx: prev.inspectorWidthPx - delta,
                          })
                        : clampPanelLayout({
                            ...prev,
                            inspectorHeightPx: prev.inspectorHeightPx - delta,
                          })
                    )
                  }
                  onDoubleClickReset={() =>
                    setPanelLayout((prev) => ({
                      ...prev,
                      inspectorWidthPx: PANEL_LIMITS.inspectorW.defaultPx,
                      inspectorHeightPx: PANEL_LIMITS.inspectorH.defaultPx,
                      inspectorCollapsed: false,
                    }))
                  }
                  label="Inspector Panel"
                  testId="splitter-inspector"
                  toggleTestId="toggle-inspector-panel-btn"
                />
              )}

              {/* Right Contextual Inspector */}
              {(!panelLayout.inspectorCollapsed || panelLayout.stageCollapsed) && (
                <aside
                  data-testid="studio-right-inspector"
                  style={
                    panelLayout.stageCollapsed
                      ? undefined
                      : isLgUp
                      ? { width: `${panelLayout.inspectorWidthPx}px` }
                      : { height: `${panelLayout.inspectorHeightPx}px` }
                  }
                  className={
                    panelLayout.stageCollapsed
                      ? 'min-h-0 min-w-0 flex-1 overflow-y-auto bg-[var(--surface-1)]'
                      : 'w-full shrink-0 overflow-y-auto bg-[var(--surface-1)] lg:h-full'
                  }
                >
                {workspace === 'animation' && (
                  <AnimationInspector
                    lang={lang}
                    strings={strings}
                    activeCharacter={characterManifest}
                    onOpenStageCharacterModal={() => setStageModalOpen(true)}
                    savedRiggedCharacters={savedRiggedCharacters}
                    saveCharacterProgress={saveCharacterProgress}
                    saveCharacterError={saveCharacterError}
                    onSaveCharacterForever={handleSaveCharacterForever}
                    onLoadSavedCharacter={handleLoadSavedCharacter}
                    onDeleteSavedCharacter={handleDeleteSavedCharacter}
                    material={materialSettings}
                    onChangeMaterial={(patch) =>
                      setMaterialSettings((prev) => ({ ...prev, ...patch }))
                    }
                    onFrameCamera={(preset) => viewportRef.current?.framePreset(preset)}
                    boneNames={characterManifest.diagnostics.boneNames}
                    propsList={propsList}
                    onAddProp={(kind) => {
                      const bone =
                        characterManifest.diagnostics.boneNames.find((b) => b.includes('RightHand')) ||
                        null;
                      setPropsList((prev) => [
                        ...prev,
                        {
                          id: `prop-${Date.now()}`,
                          name: kind === 'blade' ? 'Katana Ref' : kind === 'mic' ? 'Studio Mic' : 'Ref Cube',
                          assetId: `builtin_${kind}`,
                          attachedBoneName: bone,
                          visible: true,
                          transform: {
                            position: { x: 0, y: 0.02, z: 0.04 },
                            rotation: { x: 0, y: 0, z: 0 },
                            scale: { x: 1, y: 1, z: 1 },
                          },
                        },
                      ]);
                    }}
                    onUpdateProp={(id, patch) =>
                      setPropsList((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
                    }
                    onRemoveProp={(id) =>
                      setPropsList((prev) => prev.filter((p) => p.id !== id))
                    }
                    environmentBg={environmentBg}
                    onUploadEnvironmentImage={(file) => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        setEnvironmentBg({
                          id: `env-${Date.now()}`,
                          name: file.name,
                          dataUrlOrPath: String(reader.result),
                        });
                      };
                      reader.readAsDataURL(file);
                    }}
                    onClearEnvironment={() => setEnvironmentBg(null)}
                    onRunAiDirection={async (prompt) => {
                      return directMotionRequest({
                        prompt,
                        language: lang,
                        availableClipNames: characterManifest.clipSettings
                          .filter((c) => c.compatible)
                          .map((c) => c.sourceName),
                        hasSkinWeights: characterManifest.diagnostics.hasSkinWeights,
                      });
                    }}
                    onApplyDirectedSequence={(res: MotionDirectionResult) => {
                      let cursor = 0;
                      const mapped: TimelineClipItem[] = res.sequence.map((step, idx) => {
                        const item: TimelineClipItem = {
                          id: `ai-${Date.now()}-${idx}`,
                          sourceClipName: step.sourceClipName,
                          label: step.label,
                          startSec: cursor,
                          durationSec: step.durationSec,
                          speed: step.speed,
                          loop: step.loop,
                          sourceKind: 'preset',
                        };
                        cursor += step.durationSec;
                        return item;
                      });
                      setTimelineClips(mapped);
                      if (mapped[0]) setActiveClipName(mapped[0].sourceClipName);
                      setTimelineMode('clips');
                      setTimelineDurationSec(clampTimelineDuration(cursor));
                      setIsPlaying(true);
                    }}
                    renderDurationSec={renderDurationSec}
                    onChangeRenderDuration={(s) => setRenderDurationSec(clampTimelineDuration(s))}
                    renderProgress={renderProgress}
                    renderNote={renderNote}
                    onRecordVideo={async (fps) => {
                      if (!viewportRef.current) return;
                      renderAbortRef.current?.abort();
                      const ctrl = new AbortController();
                      renderAbortRef.current = ctrl;
                      setRenderProgress(1);
                      setRenderNote(null);
                      try {
                        const out = await viewportRef.current.recordVideo({
                          durationSec: renderDurationSec,
                          fps,
                          onProgress: setRenderProgress,
                          signal: ctrl.signal,
                          onStepTime: setCurrentTimeSec,
                        });
                        triggerBlobDownload(out.blob, `rapuso_scene.${out.extension}`);
                        setRenderNote(`Saved ${out.extension.toUpperCase()} (${out.mimeType}) · ${out.actualFpsNote}`);
                      } catch (err) {
                        if ((err as Error).name !== 'AbortError') {
                          setRenderNote((err as Error).message);
                        }
                      } finally {
                        setRenderProgress(null);
                      }
                    }}
                    onExportFramesZip={async (fps) => {
                      if (!viewportRef.current) return;
                      renderAbortRef.current?.abort();
                      const ctrl = new AbortController();
                      renderAbortRef.current = ctrl;
                      setRenderProgress(1);
                      setRenderNote(null);
                      try {
                        const zip = await viewportRef.current.exportFramesZip({
                          durationSec: renderDurationSec,
                          fps,
                          manifestJson: JSON.stringify(buildCurrentManifest(), null, 2),
                          onProgress: setRenderProgress,
                          signal: ctrl.signal,
                          onStepTime: setCurrentTimeSec,
                        });
                        triggerBlobDownload(
                          new Blob([new Uint8Array(zip)], { type: 'application/zip' }),
                          'rapuso_frames.zip'
                        );
                        setRenderNote('Exported PNG frames + manifest ZIP');
                      } catch (err) {
                        if ((err as Error).name !== 'AbortError') {
                          setRenderNote((err as Error).message);
                        }
                      } finally {
                        setRenderProgress(null);
                      }
                    }}
                    onCancelRender={() => renderAbortRef.current?.abort()}
                    rasterSettings={rasterSettings}
                    onChangeRasterSettings={(patch) => {
                      setRasterSettings((prev) => {
                        const next = validateRasterSettings({ ...prev, ...patch });
                        if (
                          patch.cameraFraming !== undefined ||
                          patch.cameraZoom !== undefined ||
                          patch.cameraOrbitYawDeg !== undefined ||
                          patch.cameraOrbitPitchDeg !== undefined ||
                          patch.cameraRollDeg !== undefined ||
                          patch.cameraPanX !== undefined ||
                          patch.cameraPanY !== undefined ||
                          patch.cameraFov !== undefined
                        ) {
                          viewportRef.current?.applyRasterCameraPreview(next);
                        }
                        return next;
                      });
                    }}
                    onCaptureRasterCurrentView={() => handleRunRasterCapture(['perspective'])}
                    rasterBusy={rasterBusy}
                    latestRaster={rasterOutputs[0] ?? null}
                    onOpenRasterStudio={() => {
                      setRequestedPoseSubTab((prev) => ({ tab: 'raster', seq: (prev?.seq ?? 0) + 1 }));
                      setWorkspace('pose');
                    }}
                  />
                )}

                {workspace === 'characters' && (
                  <CharacterProduction
                    lang={lang}
                    strings={strings}
                    activeCharacter={characterManifest}
                    savedServerCharacters={serverCharacters}
                    localCharacters={[]}
                    activeClipName={activeClipName}
                    onUploadCharacterBundle={handleUploadCharacterBundle}
                    onUploadAnimationClips={handleUploadAnimationClips}
                    onLoadDemoCharacter={handleLoadDemoCharacter}
                    onSelectClip={(name) => {
                      setActiveClipName(name);
                      setTimelineMode('clips');
                      setIsPlaying(true);
                    }}
                    onUpdateClipSetting={(clipId, patch) =>
                      setCharacterManifest((prev) => ({
                        ...prev,
                        clipSettings: prev.clipSettings.map((c) =>
                          c.id === clipId ? { ...c, ...patch } : c
                        ),
                      }))
                    }
                    onAddTextureBinding={handleAddTextureBinding}
                    onClearTextureBindings={handleClearTextureBindings}
                    onSaveCharacterToServer={async () => {
                      const saved = await saveServerCharacter(characterManifest);
                      setCharacterManifest(saved);
                      setServerCharacters(await listServerCharacters());
                      setStatusBanner(`Saved character ID: ${saved.savedRecordId}`);
                    }}
                    onSaveCharacterLocally={() => {
                      setCharacterManifest((prev) => ({
                        ...prev,
                        persistenceScope: 'local_browser',
                      }));
                      setStatusBanner('Character manifest cached in browser draft');
                    }}
                    onLoadCharacterManifest={async (manifest) => {
                      setCharacterManifest(manifest);
                      setStatusBanner(`Loaded manifest "${manifest.name}" (${manifest.diagnostics.boneCount} bones)`);
                    }}
                    onDeleteServerCharacter={async (recId) => {
                      await deleteServerCharacter(recId);
                      setServerCharacters(await listServerCharacters());
                    }}
                    onRefreshServerCharacters={async () => {
                      setServerCharacters(await listServerCharacters());
                    }}
                    onExportGlb={async () => {
                      const bytes = await exportCharacterToGlb(subjectRoot, clips);
                      triggerBlobDownload(
                        new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' }),
                        `${characterManifest.name.replace(/\s+/g, '_')}.glb`
                      );
                      setStatusBanner('Exported genuine animated GLB');
                    }}
                    onExportBvh={() => {
                      const bvhText = exportPoseOrClipToBvh(subjectRoot, 4, 1 / 30);
                      triggerBlobDownload(
                        new Blob([bvhText], { type: 'text/plain' }),
                        `${characterManifest.name.replace(/\s+/g, '_')}.bvh`
                      );
                      setStatusBanner('Exported skeletal BVH');
                    }}
                  />
                )}

                {workspace === 'pose' && (
                  <PoseDrawingWorkspace
                    lang={lang}
                    strings={strings}
                    boneNames={characterManifest.diagnostics.boneNames}
                    hasSkinWeights={characterManifest.diagnostics.hasSkinWeights}
                    hasArticulatedFingers={characterManifest.diagnostics.hasArticulatedFingers}
                    selectedBoneName={selectedBoneName}
                    onSelectBone={setSelectedBoneName}
                    showGizmoRings={showGizmoRings}
                    onToggleGizmoRings={setShowGizmoRings}
                    boneRotations={manualBoneRotations}
                    bonePositions={manualBonePositions}
                    onSetBoneRotation={(boneName, euler) =>
                      commitManualRotations({ ...manualBoneRotations, [boneName]: euler })
                    }
                    onSetBonePosition={(boneName, pos) => {
                      setManualBonePositions((prev) => ({ ...prev, [boneName]: pos }));
                      setTimelineMode('pose_keyframes');
                      setIsPlaying(false);
                    }}
                    onUndoPose={() => {
                      const prev = poseUndoStack[poseUndoStack.length - 1];
                      if (!prev) return;
                      setPoseUndoStack((s) => s.slice(0, -1));
                      setManualBoneRotations(prev);
                    }}
                    canUndo={poseUndoStack.length > 0}
                    onResetPose={() => {
                      commitManualRotations({});
                      setManualBonePositions({});
                      setFingerControls(createDefaultFingerControls());
                    }}
                    fingerControls={fingerControls}
                    onChangeFingerControls={(fc) => {
                      setFingerControls(fc);
                      setTimelineMode('pose_keyframes');
                      setIsPlaying(false);
                    }}
                    ikTargets={ikTargets}
                    onUpdateIkTarget={(limb, patch) =>
                      setIkTargets((prev) => ({ ...prev, [limb]: { ...prev[limb], ...patch } }))
                    }
                    onApplyIkLimb={(limb: IkLimbId) => {
                      const st = ikTargets[limb];
                      const res = solveIkTargetForRig(
                        subjectRoot,
                        restPose,
                        limb,
                        st.target,
                        st.respectBendLimits
                      );
                      if (res.warning) {
                        setStatusBanner(res.warning);
                        return;
                      }
                      commitManualRotations({ ...manualBoneRotations, ...res.patch });
                      setStatusBanner(`Solved ${limb} IK (${Math.round(res.reachRatio * 100)}% reach)`);
                    }}
                    savedPoses={savedPoses}
                    onSaveNamedPose={(name) => {
                      const pose: NamedPose = {
                        id: `np-${Date.now()}`,
                        name: name.trim() || 'Named Pose',
                        createdAt: new Date().toISOString(),
                        boneRotations: { ...manualBoneRotations },
                        source: 'manual',
                      };
                      setSavedPoses((prev) => [pose, ...prev]);
                      setStatusBanner(`Saved pose "${pose.name}"`);
                    }}
                    onApplyNamedPose={(p) => {
                      commitManualRotations(p.boneRotations);
                      setStatusBanner(`Loaded pose "${p.name}"`);
                    }}
                    onAddPoseKeyframe={(label) => {
                      const kf: PoseKeyframe = {
                        id: `kf-${Date.now()}`,
                        timeSec: Number(currentTimeSec.toFixed(2)),
                        label: label.trim() || `Key ${poseKeyframes.length + 1}`,
                        boneRotations: { ...manualBoneRotations },
                      };
                      setPoseKeyframes((prev) => [...prev, kf].sort((a, b) => a.timeSec - b.timeSec));
                      setTimelineMode('pose_keyframes');
                      setStatusBanner(`Added pose keyframe @ ${kf.timeSec}s`);
                    }}
                    driverState={driverState}
                    onUpdateDriverRotations={(rot) =>
                      setDriverState((prev) => ({ ...prev, driverBoneRotations: rot }))
                    }
                    onUpdateDriverPositions={(pos) =>
                      setDriverState((prev) => ({ ...prev, driverBonePositions: pos }))
                    }
                    onUpdateDriverFingers={(fc) =>
                      setDriverState((prev) => ({ ...prev, driverFingerControls: fc }))
                    }
                    onCopyMannequinPose={() => {
                      const hasRot = Object.keys(driverState.driverBoneRotations).length > 0;
                      const hasPos = Object.keys(driverState.driverBonePositions || {}).length > 0;
                      if (!hasRot && !hasPos) {
                        commitManualRotations({});
                        setManualBonePositions({});
                        setFingerControls(driverState.driverFingerControls);
                        setStatusBanner('Applied Mannequin Rest T-Pose to target rig');
                        return;
                      }
                      const report = retargetPoseAcrossRigs(
                        mannequinRefRig.root,
                        driverState.driverBoneRotations,
                        subjectRoot,
                        restPose,
                        mannequinRestPose,
                        driverState.driverBonePositions
                      );
                      commitManualRotations(report.rotations);
                      setManualBonePositions(report.positions);
                      setFingerControls(driverState.driverFingerControls);
                      setStatusBanner(
                        `Copied mannequin pose (${report.mappedCount} mapped bones)${
                          report.notes[0] ? ` · ${report.notes[0]}` : ''
                        }`
                      );
                    }}
                    onToggleMannequinLiveFollow={(enabled) =>
                      setDriverState((prev) => ({ ...prev, liveFollow: enabled }))
                    }
                    referenceSlots={referenceSlots}
                    onUploadReferenceSlotImage={(view: ReferenceSlotView, file: File) => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        setReferenceSlots((prev) =>
                          prev.map((s) =>
                            s.view === view
                              ? {
                                  ...s,
                                  imageUrl: String(reader.result),
                                  imageName: file.name,
                                  landmarks: [],
                                  detectionSource: 'none',
                                }
                              : s
                          )
                        );
                      };
                      reader.readAsDataURL(file);
                    }}
                    onDetectReferenceSlot={async (view, subjIdx = 0) => {
                      const target = referenceSlots.find((s) => s.view === view);
                      if (!target?.imageUrl) return;
                      const det = await detectStillImagePose(target.imageUrl, subjIdx);
                      const nextSlots = referenceSlots.map((s) =>
                        s.view === view
                          ? {
                              ...s,
                              landmarks: det.landmarks,
                              confidenceMean: det.confidenceMean,
                              missingJoints: det.missingJoints,
                              detectionSource: det.detectionSource,
                              statusNote: det.statusNote,
                            }
                          : s
                      );
                      setReferenceSlots(nextSlots);
                      // Immediately fit the 2D Ref & Driver mannequin to the detected reference pose!
                      syncMannequinFromReferenceSlots(nextSlots, `MediaPipe (${view})`);
                    }}
                    onUpdateReferenceLandmark={(view, lmIdx, x, y) => {
                      setReferenceSlots((prev) => {
                        const nextSlots = prev.map((s) =>
                          s.view === view
                            ? {
                                ...s,
                                landmarks: s.landmarks.map((pt) =>
                                  pt.index === lmIdx ? { ...pt, x, y, editedManually: true } : pt
                                ),
                              }
                            : s
                        );
                        syncMannequinFromReferenceSlots(nextSlots, 'Manual landmark');
                        return nextSlots;
                      });
                    }}
                    onConfirmSamePose={(view, confirmed) => {
                      setReferenceSlots((prev) =>
                        prev.map((s) =>
                          s.view === view ? { ...s, samePoseConfirmed: confirmed } : s
                        )
                      );
                    }}
                    onApplyReferenceSlotsPose={(primaryView) => {
                      setDriverState((prev) => ({ ...prev, liveFollow: false }));
                      const solved = solveReferenceSlotsToBoneRotations(
                        subjectRoot,
                        referenceSlots,
                        primaryView
                      );
                      commitManualRotations(solved.rotations);
                      setStatusBanner(
                        `Fitted ${solved.mappedJointsCount} joints from ${primaryView} ref`
                      );
                    }}
                    onApplyMultiViewToMannequin={async (subjIdx = 0) => {
                      const activeSlots = referenceSlots.filter(
                        (s) => Boolean(s.imageUrl) || s.landmarks.length > 0
                      );
                      if (activeSlots.length === 0) {
                        const msg =
                          'Upload Front, Side, or Rear image(s) inside Multi-View Pose Reference first.';
                        setMultiViewNote(msg);
                        setStatusBanner(msg);
                        return;
                      }
                      setMultiViewBusy(true);
                      setMultiViewNote(null);
                      try {
                        const updatedSlots = await Promise.all(
                          referenceSlots.map(async (slot) => {
                            if (slot.imageUrl && slot.landmarks.length === 0) {
                              const det = await detectStillImagePose(slot.imageUrl, subjIdx);
                              return {
                                ...slot,
                                landmarks: det.landmarks,
                                confidenceMean: det.confidenceMean,
                                missingJoints: det.missingJoints,
                                detectionSource: det.detectionSource,
                                statusNote: det.statusNote,
                              };
                            }
                            return slot;
                          })
                        );
                        setReferenceSlots(updatedSlots);

                        const solved = solveMultiViewPoseForMannequin(
                          mannequinRefRig.root,
                          updatedSlots
                        );
                        setDriverState((prev) => ({
                          ...prev,
                          driverBoneRotations: solved.rotations,
                          lastSyncedAt: new Date().toISOString(),
                        }));
                        const note = solved.notes[0] || 'Updated Mannequin Driver from 2D Pose Ref.';
                        setMultiViewNote(note);
                        setStatusBanner(note);
                      } catch (err) {
                        const errMsg = (err as Error).message;
                        setMultiViewNote(errMsg);
                        setStatusBanner(errMsg);
                      } finally {
                        setMultiViewBusy(false);
                      }
                    }}
                    multiViewBusy={multiViewBusy}
                    multiViewNote={multiViewNote}
                    selectedLibraryPose={selectedLibraryPose}
                    onSelectLibraryPose={setSelectedLibraryPose}
                    onChangePoseFromLibrary={handleChangePoseFromLibrary}
                    rasterSettings={rasterSettings}
                    onChangeRasterSettings={(patch) => {
                      setRasterSettings((prev) => {
                        const next = validateRasterSettings({ ...prev, ...patch });
                        if (
                          patch.cameraFraming !== undefined ||
                          patch.cameraZoom !== undefined ||
                          patch.cameraOrbitYawDeg !== undefined ||
                          patch.cameraOrbitPitchDeg !== undefined ||
                          patch.cameraRollDeg !== undefined ||
                          patch.cameraPanX !== undefined ||
                          patch.cameraPanY !== undefined ||
                          patch.cameraFov !== undefined
                        ) {
                          viewportRef.current?.applyRasterCameraPreview(next);
                        }
                        return next;
                      });
                    }}
                    onResetRasterCamera={() => {
                      setRasterSettings((prev) => {
                        const next = validateRasterSettings({
                          ...prev,
                          cameraFraming: 'full',
                          cameraZoom: 1.0,
                          cameraOrbitYawDeg: 0,
                          cameraOrbitPitchDeg: 0,
                          cameraRollDeg: 0,
                          cameraPanX: 0,
                          cameraPanY: 0,
                          cameraFov: 38,
                        });
                        viewportRef.current?.applyRasterCameraPreview(next);
                        return next;
                      });
                    }}
                    rasterSceneAssets={rasterSceneAssets}
                    onAddRasterSceneImages={handleAddRasterSceneImages}
                    onRemoveRasterSceneImage={(kind, id) =>
                      setRasterSceneAssets((prev) => ({
                        ...prev,
                        [kind]: prev[kind].filter((x) => x.id !== id),
                      }))
                    }
                    onClearRasterSceneCategory={(kind) =>
                      setRasterSceneAssets((prev) => ({ ...prev, [kind]: [] }))
                    }
                    rasterOutputs={rasterOutputs}
                    activeRasterId={activeRasterId}
                    onSelectRasterId={setActiveRasterId}
                    onUpdateRasterPlacement={handleUpdateRasterPlacement}
                    onRunRasterCapture={handleRunRasterCapture}
                    onDownloadRasterZip={(rec) => void handleDownloadRasterZip(rec)}
                    rasterBusy={rasterBusy}
                    onCancelRaster={() => rasterAbortRef.current?.abort()}
                    stageMinimized={panelLayout.stageCollapsed}
                    onToggleStageMinimized={() =>
                      setPanelLayout((prev) => toggleStageMinimizeLayout(prev))
                    }
                    requestedSubTab={requestedPoseSubTab}
                  />
                )}
                </aside>
              )}
            </div>
          ) : workspace === 'poseLibrary' ? (
            <PoseLibraryWorkspace
              lang={lang}
              strings={strings}
              onUsePoseInStudio={(pose) => void handleChangePoseFromLibrary(pose)}
            />
          ) : (
            <AssetLibraryWorkspace
              lang={lang}
              strings={strings}
              serverProjects={serverProjects}
              savedPoses={savedPoses}
              onLoadProject={(proj) => {
                setProjectId(proj.id);
                setProjectName(proj.name);
                setTimelineMode(proj.timelineMode);
                setTimelineDurationSec(proj.timelineDurationSec);
                setPoseKeyframes(proj.poseKeyframes);
                setSavedPoses(proj.savedPoses);
                setManualBoneRotations(proj.activeBoneRotations);
                setPropsList(proj.props);
                setMaterialSettings(proj.material);
                setWorkspace('animation');
                setStatusBanner(`Loaded project "${proj.name}"`);
              }}
              onDeleteServerProject={async (id) => {
                await deleteServerProject(id);
                setServerProjects(await listServerProjects());
              }}
              onRefreshProjects={async () => {
                setServerProjects(await listServerProjects());
              }}
              onApplySavedPose={(pose) => {
                commitManualRotations(pose.boneRotations);
                setWorkspace('pose');
                setStatusBanner(`Applied saved pose "${pose.name}"`);
              }}
            />
          )}
        </main>
      </div>

      <StudioGuideModal open={guideOpen} lang={lang} onClose={() => setGuideOpen(false)} />
      <StageCharacterModal
        open={stageModalOpen}
        lang={lang}
        onClose={() => setStageModalOpen(false)}
        activeCharacter={characterManifest}
        onStageCharacterBundle={stageValidatedCharacterBundle}
        onSaveCharacterForever={handleSaveCharacterForever}
        saveCharacterProgress={saveCharacterProgress}
      />
    </div>
  );
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
