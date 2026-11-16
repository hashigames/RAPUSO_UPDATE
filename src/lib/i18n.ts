import type { LanguageCode, WorkspaceId } from '../../shared/studio';

export interface StudioStrings {
  brandName: string;
  brandSub: string;
  companyAttribution: string;
  tagline: string;
  nav: Record<WorkspaceId, string>;
  themeIndigo: string;
  themeGraphite: string;
  guideButton: string;
  saveProjectLocal: string;
  saveProjectServer: string;
  exportProjectJson: string;
  importProjectJson: string;
  uploadCharacterBtn: string;
  timelineClipsMode: string;
  timelineKeyframesMode: string;
  directMotionLabel: string;
  directMotionPlaceholder: string;
  directMotionRun: string;
  renderVideoBtn: string;
  exportFrameZipBtn: string;
  recordDurationLabel: string;
  poseLibraryUploadTitle: string;
  poseLibraryNotice: string;
  poseLibrarySearchPlaceholder: string;
  changePoseBtn: string;
  mannequinDriverTitle: string;
  mannequinCopyPose: string;
  mannequinLiveFollow: string;
  rasterGenerateMultiView: string;
  rasterSingleCapture: string;
  cameraPresets: {
    perspective: string;
    front: string;
    side: string;
    back: string;
  };
  categories: {
    all: string;
    girl: string;
    boy: string;
    unsorted: string;
  };
  persistenceDisclosure: string;
}

const EN: StudioStrings = {
  brandName: 'RAPUSO',
  brandSub: 'らぷそ',
  companyAttribution: 'LIGHTHOUSE 橋',
  tagline: 'Direct the motion. Keep the character.',
  nav: {
    animation: 'Animation Studio',
    characters: 'Characters',
    pose: 'Pose & Drawing',
    poseLibrary: '2D Poses Library',
    assets: 'Asset Library',
  },
  themeIndigo: 'Ink Indigo',
  themeGraphite: 'Graphite',
  guideButton: 'Studio Guide',
  saveProjectLocal: 'Save Draft Locally',
  saveProjectServer: 'Save Project to Studio Server',
  exportProjectJson: 'Export .rapuso.json',
  importProjectJson: 'Import Project JSON',
  uploadCharacterBtn: 'Upload Character',
  timelineClipsMode: 'Motion Clips',
  timelineKeyframesMode: 'Pose keyframes only',
  directMotionLabel: 'AI Motion Director (EN / JA)',
  directMotionPlaceholder: 'e.g. Wave cheerfully, then walk forward for 4 seconds',
  directMotionRun: 'Translate Prompt',
  renderVideoBtn: 'Record Scene Video',
  exportFrameZipBtn: 'Export PNG Frames ZIP',
  recordDurationLabel: 'Duration (1–600s)',
  poseLibraryUploadTitle: 'Batch Upload 2D Pose References',
  poseLibraryNotice:
    'Gemini Vision suggests Girl / Boy only for clearly fictional drawn characters. Photos, multi-person scenes, and ambiguous drawings stay Unsorted. Uploads are stored in studio server storage.',
  poseLibrarySearchPlaceholder: 'Search pose name…',
  changePoseBtn: 'Change Pose',
  mannequinDriverTitle: 'Pose Mannequin Driver (Built-in)',
  mannequinCopyPose: 'Copy Pose to Rig',
  mannequinLiveFollow: 'Live Follow',
  rasterGenerateMultiView: 'Multi-View Raster (Selected Views)',
  rasterSingleCapture: 'Capture Current View',
  cameraPresets: {
    perspective: '3D Perspective',
    front: 'Front',
    side: 'Side',
    back: 'Back',
  },
  categories: {
    all: 'All',
    girl: 'Girl',
    boy: 'Boy',
    unsorted: 'Unsorted',
  },
  persistenceDisclosure:
    'Local drafts use browser IndexedDB/localStorage. Server saves write to the AI Studio Express storage (.rapuso-data/). No live Firebase connection is claimed without credentials.',
};

const JA: StudioStrings = {
  brandName: 'RAPUSO',
  brandSub: 'らぷそ',
  companyAttribution: 'LIGHTHOUSE 橋',
  tagline: '動きを演出し、キャラクターはそのままに。',
  nav: {
    animation: 'アニメーション制作',
    characters: 'キャラクター',
    pose: 'ポーズ・作画出力',
    poseLibrary: '2Dポーズライブラリ',
    assets: 'アセットライブラリ',
  },
  themeIndigo: 'インク藍',
  themeGraphite: 'グラファイト',
  guideButton: '操作ガイド',
  saveProjectLocal: 'ブラウザに下書き保存',
  saveProjectServer: 'サーバーにプロジェクト保存',
  exportProjectJson: '.rapuso.json 書き出し',
  importProjectJson: 'JSON読み込み',
  uploadCharacterBtn: 'キャラクター読み込み',
  timelineClipsMode: 'モーションクリップ',
  timelineKeyframesMode: 'ポーズキーフレームのみ',
  directMotionLabel: 'AIモーション演出 (日/英)',
  directMotionPlaceholder: '例：元気よく手を振ってから4秒間前に歩く',
  directMotionRun: 'プロンプト変換',
  renderVideoBtn: 'シーン動画録画',
  exportFrameZipBtn: 'PNG連番ZIP書き出し',
  recordDurationLabel: '尺 (1〜600秒)',
  poseLibraryUploadTitle: '2Dポーズ参考画像を一括アップロード',
  poseLibraryNotice:
    'Gemini Vision は明確な創作イラストのみ「Girl / Boy」を提案します。写真・複数人物・曖昧な画像は「Unsorted」に分類されます。',
  poseLibrarySearchPlaceholder: 'ポーズ名で検索…',
  changePoseBtn: 'Change Pose（ポーズ適用）',
  mannequinDriverTitle: 'ポーズ用マネキンドライバー（内蔵）',
  mannequinCopyPose: 'リグへポーズ転送',
  mannequinLiveFollow: 'ライブ連動',
  rasterGenerateMultiView: 'マルチビュー線画・着色一括生成',
  rasterSingleCapture: '現在の視点を出力',
  cameraPresets: {
    perspective: '3Dパース',
    front: '正面',
    side: '側面',
    back: '背面',
  },
  categories: {
    all: 'すべて',
    girl: 'Girl（女性向け作画）',
    boy: 'Boy（男性向け作画）',
    unsorted: 'Unsorted（未分類）',
  },
  persistenceDisclosure:
    'ローカル下書きはブラウザのIndexedDBに保存されます。サーバー保存はスタジオサーバー(.rapuso-data/)へ永続化されます。Firebaseは未接続のため認証なしでは使用しません。',
};

export function getStudioStrings(lang: LanguageCode): StudioStrings {
  return lang === 'ja' ? JA : EN;
}
