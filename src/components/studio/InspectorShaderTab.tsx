import React, { useRef } from 'react';
import { ArrowUpRight, Camera, Eye, Layers, Sparkles } from 'lucide-react';
import type { LanguageCode } from '../../../shared/studio';
import {
  ANIME_SHADER_PRESET_CATALOG,
  type AnimeShaderPreset,
  type AnimeShadowTint,
  type BackgroundHarmonyMode,
  getAnimeShaderPresetDefaults,
  type InkPenStyle,
  type MangaOverlayEffect,
  type RasterOutputRecord,
  type RasterRenderSettings,
  type RasterStyleMode,
} from '../../../shared/pose-raster';

interface InspectorShaderTabProps {
  lang: LanguageCode;
  rasterSettings: RasterRenderSettings;
  onChangeRasterSettings: (patch: Partial<RasterRenderSettings>) => void;
  viewportToonEnabled: boolean;
  onToggleViewportToon: (enabled: boolean) => void;
  onCaptureCurrentView: () => Promise<void>;
  rasterBusy: boolean;
  latestRaster: RasterOutputRecord | null;
  onOpenRasterStudio: () => void;
}

const PRESET_SWATCH_STYLES: Record<AnimeShaderPreset, React.CSSProperties> = {
  hard_cel: {
    background: 'linear-gradient(135deg, #f8d4de 0% 52%, #555986 52% 100%)',
    borderColor: '#191b28',
  },
  halftone_screen: {
    backgroundColor: '#f3f1eb',
    backgroundImage:
      'radial-gradient(#1a1c24 1.35px, transparent 1.35px), radial-gradient(#1a1c24 1.35px, #f3f1eb 1.35px)',
    backgroundSize: '7px 7px',
    backgroundPosition: '0 0, 3.5px 3.5px',
  },
  ink_outline: {
    background:
      'linear-gradient(150deg, #faf9f5 0% 62%, #14161f 62% 72%, #faf9f5 72% 100%)',
  },
  anime_tv: {
    background: 'linear-gradient(135deg, #f7d9e4 0% 58%, #6d6998 58% 100%)',
  },
  shonen_manga: {
    backgroundColor: '#eceae2',
    backgroundImage: 'radial-gradient(#20222b 1.1px, transparent 1.1px)',
    backgroundSize: '5px 5px',
  },
  shojo_pastel: {
    background: 'linear-gradient(135deg, #fde8ef 0% 58%, #c9a3b6 58% 100%)',
  },
  seinen_gekiga: {
    background:
      'repeating-linear-gradient(135deg, #f4f2ec 0 3px, #1d1f29 3px 5px)',
  },
  anime_film: {
    background: 'linear-gradient(135deg, #fce1eb 0% 42%, #8e87b8 42% 74%, #3c3a62 74% 100%)',
  },
  classic_studio: {
    background: 'linear-gradient(135deg, #f3c8d4 0% 50%, #e5b7c6 50% 100%)',
  },
};

export const InspectorShaderTab: React.FC<InspectorShaderTabProps> = ({
  lang,
  rasterSettings,
  onChangeRasterSettings,
  viewportToonEnabled,
  onToggleViewportToon,
  onCaptureCurrentView,
  rasterBusy,
  latestRaster,
  onOpenRasterStudio,
}) => {
  const previewCardRef = useRef<HTMLDivElement>(null);
  const featuredPresets = ANIME_SHADER_PRESET_CATALOG.filter((p) => p.featuredManga);
  const collectionPresets = ANIME_SHADER_PRESET_CATALOG.filter((p) => !p.featuredManga);
  const activeMeta =
    ANIME_SHADER_PRESET_CATALOG.find((p) => p.id === rasterSettings.animeShaderPreset) ??
    featuredPresets[0];

  return (
    <div className="space-y-3" data-testid="animation-inspector-shader-tab">
      {/* Header & Viewport Toon Sync */}
      <div className="rounded border border-[#343f66] bg-[#121628] p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-white">
            <Sparkles className="h-3.5 w-3.5 text-[#F4B3C2]" />
            <span>
              {lang === 'ja' ? '漫画・アニメ後処理シェーダー' : 'Anime-Toons Raster Shaders'}
            </span>
          </div>
          <span className="rounded bg-[var(--accent-mint)]/15 px-1.5 py-0.5 font-mono-tech text-[9px] text-[var(--accent-mint)]">
            {activeMeta.label}
          </span>
        </div>

        <p className="text-[10px] leading-snug text-[#9ba6ca]">
          {lang === 'ja'
            ? '作画・線画スタジオ (Raster / Manga) 用の日本式アニメ・漫画シェーダー設定。変更は即座に同期されます。'
            : 'Pre-configured Japanese anime & manga post-processing presets synced directly with the Raster / Manga studio.'}
        </p>

        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          <button
            type="button"
            data-testid="shader-viewport-toon-toggle"
            onClick={() => onToggleViewportToon(!viewportToonEnabled)}
            className={`inline-flex items-center justify-center gap-1 rounded border py-1.5 text-[10px] font-medium transition-colors ${
              viewportToonEnabled
                ? 'border-[var(--accent-mint)] bg-[var(--accent-mint)]/20 text-[var(--accent-mint)]'
                : 'border-white/15 bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <Eye className="h-3 w-3" />
            <span>{viewportToonEnabled ? 'Viewport Toon: ON' : 'Preview 3D Toon'}</span>
          </button>

          <button
            type="button"
            data-testid="shader-open-raster-studio-btn"
            onClick={onOpenRasterStudio}
            className="inline-flex items-center justify-center gap-1 rounded border border-[var(--accent-sakura)]/50 bg-[var(--accent-sakura)]/15 py-1.5 text-[10px] font-semibold text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/25"
          >
            <span>Open Raster / Manga</span>
            <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Featured Manga & Cel Presets */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[var(--text-primary)]">
            {lang === 'ja' ? '主要シェーダープリセット' : 'Featured Manga & Cel Presets'}
          </span>
          <span className="font-mono-tech text-[9px] text-[var(--text-muted)]">
            {rasterSettings.style.replace('_', ' ')}
          </span>
        </div>

        <div className="space-y-1.5">
          {featuredPresets.map((preset) => {
            const active = rasterSettings.animeShaderPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`shader-preset-${preset.id}`}
                onClick={() => onChangeRasterSettings(getAnimeShaderPresetDefaults(preset.id))}
                className={`w-full flex items-center gap-2.5 rounded border p-2 text-left transition-colors ${
                  active
                    ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/15'
                    : 'border-white/10 bg-[var(--surface-1)] hover:border-white/25'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-9 w-9 shrink-0 rounded border border-white/25 shadow-inner"
                  style={PRESET_SWATCH_STYLES[preset.id]}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-[11px] text-white">
                      {lang === 'ja' ? `${preset.label} (${preset.jaLabel})` : preset.label}
                    </span>
                    <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono-tech text-[9px] text-[var(--accent-mint)]">
                      {preset.tag}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] leading-snug text-[var(--text-secondary)]">
                    {preset.summary}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Studio Anime/Manga Collection */}
        <div className="pt-1 space-y-1">
          <div className="font-mono-tech text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
            {lang === 'ja' ? '追加スタイル集' : 'Japanese Studio Presets'}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {collectionPresets.map((preset) => {
              const active = rasterSettings.animeShaderPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`shader-preset-${preset.id}`}
                  onClick={() => onChangeRasterSettings(getAnimeShaderPresetDefaults(preset.id))}
                  className={`rounded border px-1.5 py-1.5 text-[10px] font-medium transition-colors ${
                    active
                      ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/20 text-[var(--accent-sakura-strong)]'
                      : 'border-white/10 bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Post-Processing Pipeline Controls */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
            <Layers className="h-3.5 w-3.5 text-[var(--accent-mint)]" />
            <span>{lang === 'ja' ? 'ポストプロセス調整' : 'Post-Processing Parameters'}</span>
          </span>
          <span className="font-mono-tech text-[9px] text-[var(--text-muted)]">
            {rasterSettings.resolutionWidth}px
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <label className="block text-[var(--text-secondary)]">
            Output Pass Style
            <select
              value={rasterSettings.style}
              data-testid="shader-style-select"
              onChange={(e) => onChangeRasterSettings({ style: e.target.value as RasterStyleMode })}
              aria-label="Output Pass Style"
              className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
            >
              <option value="colored_cel">Colored Cel</option>
              <option value="flat_color">Flat Color</option>
              <option value="monochrome_ink">Monochrome Ink</option>
              <option value="screentone">Halftone Screentone</option>
            </select>
          </label>

          <label className="block text-[var(--text-secondary)]">
            Cel Shadow Bands
            <select
              value={String(rasterSettings.celShadowBands)}
              data-testid="shader-cel-bands-select"
              onChange={(e) =>
                onChangeRasterSettings({ celShadowBands: Number(e.target.value) as 1 | 2 | 3 })
              }
              aria-label="Cel Shadow Bands"
              className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
            >
              <option value="1">1 Band (Graphic Ink)</option>
              <option value="2">2 Bands (Hard Cel)</option>
              <option value="3">3 Bands (Film Cel)</option>
            </select>
          </label>

          <label className="block text-[var(--text-secondary)]">
            Ink Pen Nib
            <select
              value={rasterSettings.inkPenStyle}
              onChange={(e) =>
                onChangeRasterSettings({ inkPenStyle: e.target.value as InkPenStyle })
              }
              aria-label="Ink Pen Nib"
              className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
            >
              <option value="g_pen">G-Pen (Crisp Manga)</option>
              <option value="maru_pen">Maru-Pen (Fine Hair/Eyes)</option>
              <option value="fude_brush">Fude Brush (Sumi Ink)</option>
            </select>
          </label>

          <label className="block text-[var(--text-secondary)]">
            Shadow Tint
            <select
              value={rasterSettings.shadowTint}
              onChange={(e) =>
                onChangeRasterSettings({ shadowTint: e.target.value as AnimeShadowTint })
              }
              aria-label="Shadow Tint"
              className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
            >
              <option value="cool_violet">Cool Violet (Anime Cel)</option>
              <option value="warm_sepia">Warm Sepia (Shojo)</option>
              <option value="neutral_ink">Neutral Ink (Manga)</option>
            </select>
          </label>

          <label className="block text-[var(--text-secondary)]">
            BG Harmony
            <select
              value={rasterSettings.backgroundHarmony}
              onChange={(e) =>
                onChangeRasterSettings({
                  backgroundHarmony: e.target.value as BackgroundHarmonyMode,
                })
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
            Panel Overlay
            <select
              value={rasterSettings.mangaOverlayEffect}
              onChange={(e) =>
                onChangeRasterSettings({
                  mangaOverlayEffect: e.target.value as MangaOverlayEffect,
                })
              }
              aria-label="Panel Overlay"
              className="mt-0.5 w-full rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[10px] text-white"
            >
              <option value="none">None</option>
              <option value="radial_focus">Focus Speedlines</option>
              <option value="manga_border">Manga Frame (Koma)</option>
            </select>
          </label>
        </div>

        {/* Pipeline Switches */}
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <label className="flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-1)] px-1.5 py-1 text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={rasterSettings.use3DToonShader}
              onChange={(e) => onChangeRasterSettings({ use3DToonShader: e.target.checked })}
              className="accent-[var(--accent-sakura)]"
            />
            <span className="truncate">Toon 3D</span>
          </label>
          <label className="flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-1)] px-1.5 py-1 text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={rasterSettings.supersample2x}
              onChange={(e) => onChangeRasterSettings({ supersample2x: e.target.checked })}
              className="accent-[var(--accent-mint)]"
            />
            <span className="truncate">2× AA</span>
          </label>
          <label className="flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-1)] px-1.5 py-1 text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={rasterSettings.preserveFaceDetails}
              onChange={(e) => onChangeRasterSettings({ preserveFaceDetails: e.target.checked })}
              className="accent-[var(--accent-sakura)]"
            />
            <span className="truncate">Eyes/Hair</span>
          </label>
        </div>

        {/* Sliders */}
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <label className="block text-[var(--text-secondary)]">
            Outer Ink: {rasterSettings.exteriorLineWidth}px
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

          <label className="block text-[var(--text-secondary)]">
            Inner Lines: {rasterSettings.internalEdgeThreshold.toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={rasterSettings.internalEdgeThreshold}
              onChange={(e) =>
                onChangeRasterSettings({ internalEdgeThreshold: Number(e.target.value) })
              }
              className="w-full accent-[var(--accent-sakura)]"
            />
          </label>

          <label className="block text-[var(--text-secondary)]">
            Halftone Dot: {Math.round(rasterSettings.screentoneDensity * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={rasterSettings.screentoneDensity}
              data-testid="shader-screentone-density"
              onChange={(e) =>
                onChangeRasterSettings({ screentoneDensity: Number(e.target.value) })
              }
              className="w-full accent-[var(--accent-mint)]"
            />
          </label>

          <label className="block text-[var(--text-secondary)]">
            Sharpness: {Math.round(rasterSettings.detailSharpness * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={rasterSettings.detailSharpness}
              onChange={(e) => onChangeRasterSettings({ detailSharpness: Number(e.target.value) })}
              className="w-full accent-[var(--accent-mint)]"
            />
          </label>

          <label className="block text-[var(--text-secondary)] col-span-2">
            Cel Rim Glow: {Math.round(rasterSettings.rimGlow * 100)}%
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
          <label className="flex items-center gap-1.5 text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={rasterSettings.transparentBackground}
              onChange={(e) =>
                onChangeRasterSettings({ transparentBackground: e.target.checked })
              }
            />
            Transparent BG
          </label>
          <div className="flex items-center gap-1">
            <span className="text-[var(--text-secondary)]">Paper:</span>
            <input
              type="color"
              value={rasterSettings.backgroundHex}
              onChange={(e) => onChangeRasterSettings({ backgroundHex: e.target.value })}
              className="h-5 w-7 cursor-pointer rounded border border-white/15 bg-transparent"
            />
          </div>
        </div>
      </div>

      {/* Instant Capture & Shader Output Preview */}
      <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
        <button
          type="button"
          disabled={rasterBusy}
          data-testid="shader-tab-capture-btn"
          onClick={async () => {
            await onCaptureCurrentView();
            requestAnimationFrame(() => {
              previewCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
          }}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded bg-[var(--accent-sakura)] py-2 text-[11px] font-semibold text-[#0D0F18] hover:bg-[var(--accent-sakura-strong)] disabled:opacity-50"
        >
          <Camera className="h-3.5 w-3.5" />
          <span>
            {rasterBusy
              ? 'Rendering Shader Pass…'
              : lang === 'ja'
                ? '現在のシェーダーでテスト作画出力'
                : 'Render Shader Preview (Raster)'}
          </span>
        </button>

        {latestRaster && (
          <div ref={previewCardRef} className="space-y-1.5" data-testid="shader-tab-preview-card">
            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
              <span>
                Latest: {latestRaster.view.toUpperCase()} ({latestRaster.width}×{latestRaster.height})
              </span>
              <button
                type="button"
                onClick={onOpenRasterStudio}
                className="text-[var(--accent-mint)] hover:underline"
              >
                Inspect Passes →
              </button>
            </div>
            <div className="overflow-hidden rounded border border-white/15 bg-[#090b10]">
              <img
                src={latestRaster.combinedDataUrl}
                alt={`Shader Preview ${latestRaster.view}`}
                className="mx-auto aspect-square w-full max-w-[220px] object-contain"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
