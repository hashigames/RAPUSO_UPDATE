import React from 'react';
import { X } from 'lucide-react';
import type { LanguageCode } from '../../../shared/studio';

interface StudioGuideModalProps {
  open: boolean;
  lang: LanguageCode;
  onClose: () => void;
}

export const StudioGuideModal: React.FC<StudioGuideModalProps> = ({ open, lang, onClose }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-white/15 bg-[var(--surface-1)] p-5 text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h2 className="font-display text-xl font-bold tracking-wide text-[var(--text-primary)]">
              RAPUSO / らぷそ — {lang === 'ja' ? 'スタジオ操作ガイド' : 'Studio Guide'}
            </h2>
            <p className="text-[11px] text-[var(--text-muted)]">LIGHTHOUSE 橋</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/10 bg-[var(--surface-2)] p-1.5 text-[var(--text-secondary)] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 leading-relaxed text-[var(--text-secondary)]">
          <div>
            <h3 className="font-semibold text-[var(--accent-sakura)]">
              1. {lang === 'ja' ? 'アニメーション制作 (Animation Studio)' : 'Animation Studio'}
            </h3>
            <p>
              {lang === 'ja'
                ? 'スキニング済みデモ体型または読み込んだGLB/FBXキャラクターをプレビューします。モーションクリップモードと「ポーズキーフレームのみ (1〜600秒)」を切り替え、タイムラインで再生・録画 (WebM/MP4) やPNG連番ZIP書き出しが可能です。'
                : 'Preview the bundled skinned demo humanoid or uploaded GLB/FBX characters. Combine clips or author in Pose keyframes only mode (1–600s), attach props to bones, and record WebM/MP4 video or PNG frame sequences in ZIP.'}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--accent-sakura)]">
              2. {lang === 'ja' ? 'キャラクター管理 (Characters)' : 'Characters'}
            </h3>
            <p>
              {lang === 'ja'
                ? 'GLB/glTF/FBXとコンパニオンファイル、PBRテクスチャ (UV0/UV1、上下反転、Normal-Y保護、スロット指定)、外部クリップのトラック適合確認を行い、GLBまたはBVHとして書き出せます（ネイティブFBX書き出しは非対応）。'
                : 'Inspect actual bones, skin weights, material slots, and clip bindings. Upload companion textures with UV channel and slot-safe mapping. Export genuine animated GLB or skeletal BVH (native FBX export is unsupported).'}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--accent-sakura)]">
              3. {lang === 'ja' ? 'ポーズ・作画出力 (Pose & Drawing)' : 'Pose & Drawing'}
            </h3>
            <p>
              {lang === 'ja'
                ? '3Dキャラクターの直接ボーン回転リング、手指カールプリセット、2ボーンIK、内蔵マネキンドライバー（Live Follow / Copy Pose）、2DポーズライブラリからのChange Pose、マルチビュー漫画ラスタ書き出し (3D/正面/側面/背面) を提供します。'
                : 'Edit bone rotations with local 3D gizmo rings, left/right finger curl/spread presets, two-bone hand/foot IK, built-in Pose Mannequin Driver, 2D reference detection + manual landmark guides, and multi-view non-destructive Manga Raster PNG/ZIP capture.'}
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-[var(--accent-sakura)]">
              4. {lang === 'ja' ? '2Dポーズライブラリ & アセット' : '2D Poses Library & Assets'}
            </h3>
            <p>
              {lang === 'ja'
                ? '2Dポーズ画像を一括アップロードし、Gemini VisionによるGirl/Boy/Unsorted分類提案や検索・ページング・編集が可能です。写真や複数人物・曖昧な画像はUnsortedとして安全に保持されます。'
                : 'Upload 2D pose references with queued progress/cancel/retry, search and Girl/Boy/Unsorted filters, editable names/categories, and direct Change Pose integration.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
