import { BoneRotationMap, CameraPreset, Vec3Tuple } from './studio';

export type PoseCategory = 'girl' | 'boy' | 'unsorted';

export interface PoseLibraryRecord {
  id: string;
  objectKey: string;
  name: string;
  category: PoseCategory;
  aiSuggestedCategory?: PoseCategory;
  aiConfidenceNote?: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  imageUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface PoseLibraryListResponse {
  items: PoseLibraryRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  storageNotice: string;
}

export type ReferenceSlotView = 'front' | 'side' | 'back';

export interface PoseLandmarkPoint {
  name: string;
  index: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  z: number; // normalized depth
  visibility: number; // 0..1
  editedManually?: boolean;
}

export interface ReferenceImageSlot {
  view: ReferenceSlotView;
  imageUrl: string | null;
  imageName: string | null;
  sourcePoseLibraryId?: string | null;
  landmarks: PoseLandmarkPoint[];
  confidenceMean: number;
  missingJoints: string[];
  samePoseConfirmed: boolean;
  detectionSource: 'none' | 'mediapipe_image' | 'manual';
  statusNote?: string;
}

export type IkLimbId = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';

export interface IkTargetState {
  enabled: boolean;
  target: Vec3Tuple;
  poleHint: Vec3Tuple;
  respectBendLimits: boolean;
}

export type IkTargetsMap = Record<IkLimbId, IkTargetState>;

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
export type HandSide = 'left' | 'right';
export type HandPresetId = 'open' | 'fist' | 'point' | 'relaxed';

export interface HandPoseControlState {
  curl: number; // -0.2 .. 1.4
  spread: number; // -0.5 .. 0.8
  thumbOpposed: number; // 0 .. 1.2
  axis: 'x' | 'y' | 'z';
  sign: 1 | -1;
  customFingerOverrides: Partial<Record<FingerName, number>>;
}

export interface FingerControlsState {
  left: HandPoseControlState;
  right: HandPoseControlState;
}

export interface MannequinDriverState {
  liveFollow: boolean;
  driverBoneRotations: BoneRotationMap;
  driverBonePositions?: BoneRotationMap;
  driverFingerControls: FingerControlsState;
  lastSyncedAt?: string;
}

export type RasterStyleMode = 'colored_cel' | 'flat_color' | 'monochrome_ink' | 'screentone';

export type CameraFramingPreset = 'wide' | 'full' | 'knee' | 'waist' | 'bust' | 'face' | 'viewport_exact';

export type AnimeShaderPreset =
  | 'hard_cel'
  | 'halftone_screen'
  | 'ink_outline'
  | 'anime_tv'
  | 'shonen_manga'
  | 'shojo_pastel'
  | 'seinen_gekiga'
  | 'anime_film'
  | 'classic_studio';

export interface AnimeShaderPresetMeta {
  id: AnimeShaderPreset;
  label: string;
  jaLabel: string;
  tag: string;
  summary: string;
  featuredManga?: boolean;
}

export const ANIME_SHADER_PRESET_CATALOG: AnimeShaderPresetMeta[] = [
  {
    id: 'hard_cel',
    label: 'Hard Cel',
    jaLabel: 'ハードセル',
    tag: '2-Band Cel · G-Pen',
    summary: 'Snappy 2-step anime cel shadows, crisp specular rim & G-pen contour.',
    featuredManga: true,
  },
  {
    id: 'halftone_screen',
    label: 'Halftone Screen',
    jaLabel: 'ハーフトーン網点',
    tag: '45° Amikake · B&W',
    summary: 'Rotated 45° Japanese manga dot screen tones with crisp ink blacks.',
    featuredManga: true,
  },
  {
    id: 'ink_outline',
    label: 'Ink Outline',
    jaLabel: '墨線・ペン入れ',
    tag: 'Fude Ink · Line Art',
    summary: 'Clean black-and-white manga pen linework with bold weighted contours.',
    featuredManga: true,
  },
  {
    id: 'anime_tv',
    label: 'Anime TV Cel',
    jaLabel: 'TVアニメ',
    tag: 'Broadcast Cel',
    summary: 'Balanced 2-band TV anime color cel with cool violet shadows.',
  },
  {
    id: 'shonen_manga',
    label: 'Shonen Manga',
    jaLabel: '少年漫画',
    tag: 'Screen + Koma',
    summary: 'Action manga halftone dots paired with traditional Koma frame.',
  },
  {
    id: 'shojo_pastel',
    label: 'Shojo Pastel',
    jaLabel: '少女パステル',
    tag: 'Soft Maru-Pen',
    summary: 'Warm sepia shadows, pastel bloom & delicate Maru-pen linework.',
  },
  {
    id: 'seinen_gekiga',
    label: 'Seinen Ink',
    jaLabel: '青年劇画',
    tag: 'Hatch + Speedlines',
    summary: 'Dramatic Gekiga ink shadows, diagonal cross-hatching & focus lines.',
  },
  {
    id: 'anime_film',
    label: 'Anime Film',
    jaLabel: '劇場版アニメ',
    tag: '3-Band Cinema',
    summary: 'Theatrical 3-band color depth with high rim glow & fine Maru-pen ink.',
  },
  {
    id: 'classic_studio',
    label: 'Classic Flat',
    jaLabel: 'クラシック',
    tag: 'Flat Vector Cel',
    summary: 'Unshaded flat cel fills with crisp contour lines & raw backdrop.',
  },
];

export type InkPenStyle = 'g_pen' | 'maru_pen' | 'fude_brush';
export type AnimeShadowTint = 'cool_violet' | 'warm_sepia' | 'neutral_ink';
export type BackgroundHarmonyMode = 'anime_paint' | 'manga_tone' | 'raw_photo';
export type MangaOverlayEffect = 'none' | 'radial_focus' | 'manga_border';

export const RASTER_RESOLUTION_OPTIONS = [
  { id: '768', label: '768 × 768', width: 768, height: 768 },
  { id: '1024', label: '1024 × 1024', width: 1024, height: 1024 },
  { id: '1280', label: '1280 × 1280', width: 1280, height: 1280 },
  { id: '1536', label: '1536 × 1536', width: 1536, height: 1536 },
  { id: '2048', label: '2048 × 2048 (Ultra HD)', width: 2048, height: 2048 },
] as const;

export const MAX_RASTER_TAKES_IN_PROJECT = 24;

export interface RasterImageAsset {
  id: string;
  name: string;
  dataUrl: string;
}

export interface RasterSceneAssets {
  backgroundImages: RasterImageAsset[];
  propImages: RasterImageAsset[];
  referenceImages: RasterImageAsset[];
}

export interface RasterRenderSettings {
  style: RasterStyleMode;
  animeShaderPreset: AnimeShaderPreset;
  use3DToonShader: boolean;
  inkPenStyle: InkPenStyle;
  shadowTint: AnimeShadowTint;
  rimGlow: number; // 0..1
  backgroundHarmony: BackgroundHarmonyMode;
  supersample2x: boolean;
  preserveFaceDetails: boolean;
  detailSharpness: number; // 0..1
  mangaOverlayEffect: MangaOverlayEffect;
  resolutionWidth: number;
  resolutionHeight: number;
  exteriorLineWidth: number; // 0..6
  internalEdgeThreshold: number; // 0..1
  celShadowBands: 1 | 2 | 3;
  screentoneDensity: number; // 0..1
  transparentBackground: boolean;
  backgroundHex: string;
  selectedViews: CameraPreset[];
  cameraFraming: CameraFramingPreset;
  cameraZoom: number; // 0.35..8.0 (1 = default)
  cameraOrbitYawDeg: number; // -180..180
  cameraOrbitPitchDeg: number; // -60..60
  cameraRollDeg: number; // -180..180
  cameraPanX: number; // -1.5..1.5
  cameraPanY: number; // -1.5..1.5
  cameraFov: number; // 18..75
  stylizeBackground: boolean;
  propScale: number; // 0.25..2.5
  propOffsetX: number; // -1.5..1.5
  propOffsetY: number; // -1.0..1.5
  includeReferenceOverlay: boolean;
}

export interface RasterOutputRecord {
  id: string;
  createdAt: string;
  view: CameraPreset;
  sourcePoseName: string;
  width: number;
  height: number;
  combinedDataUrl: string;
  foregroundDataUrl?: string;
  backgroundDataUrl?: string;
  foregroundOffsetX?: number; // -1..1 fraction of canvas width
  foregroundOffsetY?: number; // -1..1 fraction of canvas height
  foregroundScale?: number; // 0.35..2.5 scale around foreground center
  foregroundContentCenter?: { x: number; y: number }; // 0..1 normalized center of opaque fg pixels
  linePassDataUrl?: string;
  colorPassDataUrl?: string;
  shadowPassDataUrl?: string;
}

export function normalizePoseCategory(value: unknown): PoseCategory {
  if (typeof value !== 'string') return 'unsorted';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'girl') return 'girl';
  if (normalized === 'boy') return 'boy';
  return 'unsorted';
}

function clampFinite(val: unknown, min: number, max: number, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? Math.min(max, Math.max(min, val)) : fallback;
}

export function getAnimeShaderPresetDefaults(
  preset: AnimeShaderPreset
): Partial<RasterRenderSettings> {
  switch (preset) {
    case 'hard_cel':
      return {
        animeShaderPreset: 'hard_cel',
        style: 'colored_cel',
        use3DToonShader: true,
        inkPenStyle: 'g_pen',
        shadowTint: 'cool_violet',
        exteriorLineWidth: 2,
        internalEdgeThreshold: 0.36,
        celShadowBands: 2,
        screentoneDensity: 0.3,
        rimGlow: 0.65,
        detailSharpness: 0.65,
        backgroundHarmony: 'anime_paint',
        stylizeBackground: true,
        mangaOverlayEffect: 'none',
      };
    case 'halftone_screen':
      return {
        animeShaderPreset: 'halftone_screen',
        style: 'screentone',
        use3DToonShader: true,
        inkPenStyle: 'g_pen',
        shadowTint: 'neutral_ink',
        exteriorLineWidth: 2,
        internalEdgeThreshold: 0.38,
        celShadowBands: 2,
        screentoneDensity: 0.72,
        rimGlow: 0.15,
        detailSharpness: 0.6,
        backgroundHarmony: 'manga_tone',
        stylizeBackground: true,
        mangaOverlayEffect: 'none',
      };
    case 'ink_outline':
      return {
        animeShaderPreset: 'ink_outline',
        style: 'monochrome_ink',
        use3DToonShader: true,
        inkPenStyle: 'fude_brush',
        shadowTint: 'neutral_ink',
        exteriorLineWidth: 3,
        internalEdgeThreshold: 0.25,
        celShadowBands: 1,
        screentoneDensity: 0.4,
        rimGlow: 0.25,
        detailSharpness: 0.75,
        backgroundHarmony: 'manga_tone',
        stylizeBackground: true,
        mangaOverlayEffect: 'none',
      };
    case 'shonen_manga':
      return {
        animeShaderPreset: 'shonen_manga',
        style: 'screentone',
        use3DToonShader: true,
        inkPenStyle: 'g_pen',
        shadowTint: 'neutral_ink',
        exteriorLineWidth: 3,
        internalEdgeThreshold: 0.42,
        celShadowBands: 2,
        screentoneDensity: 0.58,
        rimGlow: 0.2,
        backgroundHarmony: 'manga_tone',
        stylizeBackground: true,
        mangaOverlayEffect: 'manga_border',
      };
    case 'shojo_pastel':
      return {
        animeShaderPreset: 'shojo_pastel',
        style: 'colored_cel',
        use3DToonShader: true,
        inkPenStyle: 'maru_pen',
        shadowTint: 'warm_sepia',
        exteriorLineWidth: 1,
        internalEdgeThreshold: 0.28,
        celShadowBands: 3,
        screentoneDensity: 0.35,
        rimGlow: 0.72,
        backgroundHarmony: 'anime_paint',
        stylizeBackground: true,
        mangaOverlayEffect: 'none',
      };
    case 'seinen_gekiga':
      return {
        animeShaderPreset: 'seinen_gekiga',
        style: 'monochrome_ink',
        use3DToonShader: true,
        inkPenStyle: 'fude_brush',
        shadowTint: 'neutral_ink',
        exteriorLineWidth: 4,
        internalEdgeThreshold: 0.5,
        celShadowBands: 2,
        screentoneDensity: 0.65,
        rimGlow: 0.35,
        backgroundHarmony: 'manga_tone',
        stylizeBackground: true,
        mangaOverlayEffect: 'radial_focus',
      };
    case 'anime_film':
      return {
        animeShaderPreset: 'anime_film',
        style: 'colored_cel',
        use3DToonShader: true,
        inkPenStyle: 'maru_pen',
        shadowTint: 'cool_violet',
        exteriorLineWidth: 2,
        internalEdgeThreshold: 0.36,
        celShadowBands: 3,
        screentoneDensity: 0.25,
        rimGlow: 0.78,
        backgroundHarmony: 'anime_paint',
        stylizeBackground: true,
        mangaOverlayEffect: 'none',
      };
    case 'classic_studio':
      return {
        animeShaderPreset: 'classic_studio',
        style: 'flat_color',
        use3DToonShader: false,
        inkPenStyle: 'g_pen',
        shadowTint: 'neutral_ink',
        exteriorLineWidth: 2,
        internalEdgeThreshold: 0.35,
        celShadowBands: 2,
        screentoneDensity: 0.4,
        rimGlow: 0.15,
        backgroundHarmony: 'raw_photo',
        stylizeBackground: false,
        mangaOverlayEffect: 'none',
      };
    case 'anime_tv':
    default:
      return {
        animeShaderPreset: 'anime_tv',
        style: 'colored_cel',
        use3DToonShader: true,
        inkPenStyle: 'g_pen',
        shadowTint: 'cool_violet',
        exteriorLineWidth: 2,
        internalEdgeThreshold: 0.34,
        celShadowBands: 2,
        screentoneDensity: 0.4,
        rimGlow: 0.5,
        backgroundHarmony: 'anime_paint',
        stylizeBackground: true,
        mangaOverlayEffect: 'none',
      };
  }
}

export function validateRasterSettings(raw: Partial<RasterRenderSettings>): RasterRenderSettings {
  const allowedSizes = new Set([768, 1024, 1280, 1536, 2048]);
  const width =
    typeof raw.resolutionWidth === 'number' && allowedSizes.has(raw.resolutionWidth)
      ? raw.resolutionWidth
      : 1024;
  const height =
    typeof raw.resolutionHeight === 'number' && allowedSizes.has(raw.resolutionHeight)
      ? raw.resolutionHeight
      : 1024;
  const bands = raw.celShadowBands === 1 || raw.celShadowBands === 3 ? raw.celShadowBands : 2;
  const views = Array.isArray(raw.selectedViews)
    ? raw.selectedViews.filter((v): v is CameraPreset =>
        ['perspective', 'front', 'side', 'back'].includes(v)
      )
    : (['perspective', 'front', 'side', 'back'] as CameraPreset[]);

  const preset = (
    [
      'hard_cel',
      'halftone_screen',
      'ink_outline',
      'anime_tv',
      'shonen_manga',
      'shojo_pastel',
      'seinen_gekiga',
      'anime_film',
      'classic_studio',
    ].includes(String(raw.animeShaderPreset))
      ? raw.animeShaderPreset
      : 'anime_tv'
  ) as AnimeShaderPreset;

  const framing = (
    ['wide', 'full', 'knee', 'waist', 'bust', 'face', 'viewport_exact'].includes(String(raw.cameraFraming))
      ? raw.cameraFraming
      : 'full'
  ) as CameraFramingPreset;

  const inkPen = (
    ['g_pen', 'maru_pen', 'fude_brush'].includes(String(raw.inkPenStyle))
      ? raw.inkPenStyle
      : 'g_pen'
  ) as InkPenStyle;

  const shadowTint = (
    ['cool_violet', 'warm_sepia', 'neutral_ink'].includes(String(raw.shadowTint))
      ? raw.shadowTint
      : 'cool_violet'
  ) as AnimeShadowTint;

  const bgHarmony = (
    ['anime_paint', 'manga_tone', 'raw_photo'].includes(String(raw.backgroundHarmony))
      ? raw.backgroundHarmony
      : 'anime_paint'
  ) as BackgroundHarmonyMode;

  const overlayEffect = (
    ['none', 'radial_focus', 'manga_border'].includes(String(raw.mangaOverlayEffect))
      ? raw.mangaOverlayEffect
      : 'none'
  ) as MangaOverlayEffect;

  return {
    style: (['colored_cel', 'flat_color', 'monochrome_ink', 'screentone'].includes(String(raw.style))
      ? raw.style
      : 'colored_cel') as RasterStyleMode,
    animeShaderPreset: preset,
    use3DToonShader: typeof raw.use3DToonShader === 'boolean' ? raw.use3DToonShader : true,
    inkPenStyle: inkPen,
    shadowTint,
    rimGlow: clampFinite(raw.rimGlow, 0, 1, 0.5),
    backgroundHarmony: bgHarmony,
    supersample2x: typeof raw.supersample2x === 'boolean' ? raw.supersample2x : true,
    preserveFaceDetails: typeof raw.preserveFaceDetails === 'boolean' ? raw.preserveFaceDetails : true,
    detailSharpness: clampFinite(raw.detailSharpness, 0, 1, 0.55),
    mangaOverlayEffect: overlayEffect,
    resolutionWidth: width,
    resolutionHeight: height,
    exteriorLineWidth: clampFinite(raw.exteriorLineWidth, 0, 6, 2),
    internalEdgeThreshold: clampFinite(raw.internalEdgeThreshold, 0, 1, 0.34),
    celShadowBands: bands,
    screentoneDensity: clampFinite(raw.screentoneDensity, 0, 1, 0.45),
    transparentBackground: typeof raw.transparentBackground === 'boolean' ? raw.transparentBackground : false,
    backgroundHex: typeof raw.backgroundHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.backgroundHex)
      ? raw.backgroundHex
      : '#f7f6f2',
    selectedViews: views.length > 0 ? views : ['perspective'],
    cameraFraming: framing,
    cameraZoom: clampFinite(raw.cameraZoom, 0.25, 8.0, 1.0),
    cameraOrbitYawDeg: clampFinite(raw.cameraOrbitYawDeg, -180, 180, 0),
    cameraOrbitPitchDeg: clampFinite(raw.cameraOrbitPitchDeg, -60, 60, 0),
    cameraRollDeg: clampFinite(raw.cameraRollDeg, -180, 180, 0),
    cameraPanX: clampFinite(raw.cameraPanX, -1.5, 1.5, 0),
    cameraPanY: clampFinite(raw.cameraPanY, -1.5, 1.5, 0),
    cameraFov: clampFinite(raw.cameraFov, 18, 75, 38),
    stylizeBackground: typeof raw.stylizeBackground === 'boolean' ? raw.stylizeBackground : true,
    propScale: clampFinite(raw.propScale, 0.25, 2.5, 1.0),
    propOffsetX: clampFinite(raw.propOffsetX, -1.5, 1.5, 0.65),
    propOffsetY: clampFinite(raw.propOffsetY, -1.0, 1.5, 0),
    includeReferenceOverlay:
      typeof raw.includeReferenceOverlay === 'boolean' ? raw.includeReferenceOverlay : false,
  };
}

export function createDefaultFingerControls(): FingerControlsState {
  return {
    left: {
      curl: 0.15,
      spread: 0.08,
      thumbOpposed: 0.2,
      axis: 'z',
      sign: 1,
      customFingerOverrides: {},
    },
    right: {
      curl: 0.15,
      spread: 0.08,
      thumbOpposed: 0.2,
      axis: 'z',
      sign: -1,
      customFingerOverrides: {},
    },
  };
}
