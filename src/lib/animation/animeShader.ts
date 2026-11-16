import * as THREE from 'three';
import type { RasterRenderSettings } from '../../../shared/pose-raster';
import { cacheOriginalMaterials, restoreOriginalMaterials, OriginalMaterialCache } from './materials';
import type { RasterPassesUint8 } from './raster';

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Stepped NearestFilter DataTexture for crisp Japanese cel-animation shadow boundaries.
 */
export function createSteppedToonGradientMap(bands: 1 | 2 | 3): THREE.DataTexture {
  const steps = bands === 1 ? [130, 255] : bands === 3 ? [86, 152, 212, 255] : [108, 184, 255];
  const data = new Uint8Array(steps.length * 4);
  for (let i = 0; i < steps.length; i++) {
    const v = steps[i];
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const EYE_MOUTH_RE =
  /(eye|iris|pupil|sclera|cornea|eyeball|lash|brow|mouth|lip|tongue|teeth|highlight|catchlight)/i;
const SKIN_FACE_RE = /(face|skin|head|cheek|ear|nose)/i;
const HAIR_RE = /(hair|bang|ahoge|ponytail|braid|twintail|strand)/i;

/**
 * Temporarily swaps character meshes to stepped MeshToonMaterial (preserving textures/alpha/emissive)
 * while protecting anime eyes, iris color, mouth, and hair details from shadow crushing.
 */
export function applyAnimeToonShaderToRoot(
  root: THREE.Object3D,
  cache: OriginalMaterialCache,
  settings: RasterRenderSettings
): { dispose: () => void } {
  cacheOriginalMaterials(root, cache);
  restoreOriginalMaterials(root, cache);

  const gradMap = createSteppedToonGradientMap(settings.celShadowBands);
  // Bright eye/face-feature gradient map so iris colors & mouth never turn muddy in shadow
  const eyeData = new Uint8Array([212, 212, 212, 255, 255, 255, 255, 255]);
  const eyeGradMap = new THREE.DataTexture(eyeData, 2, 1, THREE.RGBAFormat);
  eyeGradMap.minFilter = THREE.NearestFilter;
  eyeGradMap.magFilter = THREE.NearestFilter;
  eyeGradMap.generateMipmaps = false;
  eyeGradMap.needsUpdate = true;

  const createdMats: THREE.Material[] = [];

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const nextList = list.map((baseMat) => {
      const std = baseMat as THREE.MeshStandardMaterial;
      const baseColor = std.color ? std.color.clone() : new THREE.Color('#ffffff');
      const matLabel = `${baseMat.name || ''} ${mesh.name || ''}`;
      const isEyeOrMouth = settings.preserveFaceDetails && EYE_MOUTH_RE.test(matLabel);
      const isSkinFace = settings.preserveFaceDetails && !isEyeOrMouth && SKIN_FACE_RE.test(matLabel);
      const isHair = settings.preserveFaceDetails && HAIR_RE.test(matLabel);

      if (isEyeOrMouth) {
        // Keep anime eyes, iris colors, catchlights, brows, and mouth bright & true-color
        const unlitEye = new THREE.MeshBasicMaterial({
          name: `${baseMat.name || 'Mat'}_AnimeEye`,
          color: baseColor,
          map: std.map ?? null,
          alphaMap: std.alphaMap ?? null,
          transparent: baseMat.transparent,
          opacity: baseMat.opacity,
          alphaTest: baseMat.alphaTest,
          vertexColors: Boolean(baseMat.vertexColors),
          side: baseMat.side,
          toneMapped: false,
        });
        createdMats.push(unlitEye);
        return unlitEye;
      }

      const emissiveLift = isSkinFace
        ? 0.22
        : isHair
        ? 0.14
        : settings.animeShaderPreset === 'shojo_pastel'
        ? 0.15
        : settings.animeShaderPreset === 'anime_tv'
        ? 0.09
        : 0.05;

      const toon = new THREE.MeshToonMaterial({
        name: `${baseMat.name || 'Mat'}_AnimeToon`,
        color: baseColor,
        map: std.map ?? null,
        alphaMap: std.alphaMap ?? null,
        emissiveMap: std.emissiveMap ?? null,
        gradientMap: isSkinFace ? eyeGradMap : gradMap,
        emissive: std.emissiveMap ? new THREE.Color('#ffffff') : baseColor.clone().multiplyScalar(emissiveLift),
        emissiveIntensity: std.emissiveMap ? Math.max(0.85, std.emissiveIntensity ?? 1) : 1,
        transparent: baseMat.transparent,
        opacity: baseMat.opacity,
        alphaTest: baseMat.alphaTest,
        vertexColors: Boolean(baseMat.vertexColors),
        side: baseMat.side,
        toneMapped: false,
      });
      createdMats.push(toon);
      return toon;
    });
    mesh.material = Array.isArray(mesh.material) ? nextList : nextList[0];
  });

  return {
    dispose: () => {
      restoreOriginalMaterials(root, cache);
      for (const m of createdMats) m.dispose();
      gradMap.dispose();
      eyeGradMap.dispose();
    },
  };
}

/**
 * Fast bilinear downsampler for 2x supersampled WebGL captures so close-up eyes, hair,
 * and ink lines stay razor-sharp without jagged pixel stairs.
 */
export function downsampleRgbaBilinear(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  if (srcW === dstW && srcH === dstH) return src;
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const fy = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(srcH - 1, y0 + 1));
    const wy = Math.max(0, Math.min(1, fy - y0));

    for (let x = 0; x < dstW; x++) {
      const fx = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(fx)));
      const x1 = Math.max(0, Math.min(srcW - 1, x0 + 1));
      const wx = Math.max(0, Math.min(1, fx - x0));

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;

      const dst = (y * dstW + x) * 4;
      out[dst] = clampByte(src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11);
      out[dst + 1] = clampByte(
        src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11
      );
      out[dst + 2] = clampByte(
        src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11
      );
      out[dst + 3] = clampByte(
        src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11
      );
    }
  }
  return out;
}

/**
 * Pure Japanese anime & manga pixel shader pass pipeline:
 * - G-Pen / Maru-Pen / Fude-Brush Sobel + weighted silhouette ink outlines
 * - Cool violet / warm sepia anime shadow tinting + cel highlight rim glow
 * - True 45° rotated manga screentone halftones + seinen cross-hatching
 * - Optional radial speedlines (Shuchusen) & manga panel frame border (Koma)
 */
export function renderJapaneseAnimeMangaPasses(
  width: number,
  height: number,
  src: Uint8ClampedArray,
  settings: RasterRenderSettings
): RasterPassesUint8 {
  const len = width * height * 4;
  const combined = new Uint8ClampedArray(len);
  const linePass = new Uint8ClampedArray(len);
  const colorPass = new Uint8ClampedArray(len);
  const shadowPass = new Uint8ClampedArray(len);

  const luma = new Float32Array(width * height);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    alpha[i] = src[p + 3];
    luma[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
  }

  // Ink color & stroke thickness by pen nib style
  const inkRgb: [number, number, number] =
    settings.inkPenStyle === 'maru_pen' && settings.animeShaderPreset === 'shojo_pastel'
      ? [54, 34, 52]
      : settings.inkPenStyle === 'fude_brush'
      ? [12, 13, 18]
      : [20, 22, 32];

  const baseLineWeight = Math.max(0, Math.round(settings.exteriorLineWidth));
  const strokeRadius =
    baseLineWeight <= 0
      ? 0
      : settings.inkPenStyle === 'maru_pen'
      ? Math.max(1, Math.floor(baseLineWeight * 0.65))
      : settings.inkPenStyle === 'fude_brush'
      ? Math.min(4, Math.ceil(baseLineWeight * 0.85))
      : Math.min(3, Math.max(1, Math.round(baseLineWeight * 0.6)));

  const edgeThreshold = Math.max(10, Math.round((1 - settings.internalEdgeThreshold) * 115));

  // Precompute separate outer silhouette vs interior detail masks so dilated contours
  // never fill in fine iris colors, pupils, catchlights, mouths, or hair strands.
  const silhouetteMask = new Uint8Array(width * height);
  const interiorMask = new Uint8Array(width * height);
  const isRimMask = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const a = alpha[idx];
      if (a < 16) continue;

      const aUp = alpha[(y - 1) * width + x];
      const aDn = alpha[(y + 1) * width + x];
      const aLt = alpha[y * width + (x - 1)];
      const aRt = alpha[y * width + (x + 1)];
      const silhouette = aUp < 128 || aDn < 128 || aLt < 128 || aRt < 128;

      // Full 3x3 Sobel gradient for cleaner Japanese anime interior linework
      const tl = luma[(y - 1) * width + (x - 1)];
      const tc = luma[(y - 1) * width + x];
      const tr = luma[(y - 1) * width + (x + 1)];
      const ml = luma[y * width + (x - 1)];
      const mr = luma[y * width + (x + 1)];
      const bl = luma[(y + 1) * width + (x - 1)];
      const bc = luma[(y + 1) * width + x];
      const br = luma[(y + 1) * width + (x + 1)];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const grad = Math.sqrt(gx * gx + gy * gy) * 0.35;

      // Preserve delicate bright eye catchlights / skin highlights from getting inked over
      const isBrightFeature = settings.preserveFaceDetails && luma[idx] > 218;
      const localThresh =
        settings.inkPenStyle === 'fude_brush' && luma[idx] < 95 ? edgeThreshold * 0.78 : edgeThreshold;

      if (baseLineWeight > 0) {
        if (silhouette) {
          silhouetteMask[idx] = 1;
        } else if (!isBrightFeature && grad > localThresh) {
          interiorMask[idx] = 1;
        }
      }

      // Rim glow detection (2px inside left/top silhouette edge)
      if (settings.rimGlow > 0.05 && x > 2 && y > 2) {
        if (alpha[y * width + (x - 2)] < 90 || alpha[(y - 2) * width + x] < 90) {
          isRimMask[idx] = 1;
        }
      }
    }
  }

  const dilatedEdge = new Uint8Array(width * height);
  if (strokeRadius <= 1) {
    dilatedEdge.set(silhouetteMask);
  } else {
    const r = strokeRadius - 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!silhouetteMask[y * width + x]) continue;
        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (dx * dx + dy * dy <= r * r + 0.5) {
              dilatedEdge[ny * width + nx] = 1;
            }
          }
        }
      }
    }
  }
  // If preserveFaceDetails is off, allow interior edges to follow stroke dilation;
  // when preserveFaceDetails is on, keep interior edges razor-thin 1px hairlines!
  if (!settings.preserveFaceDetails && strokeRadius > 1) {
    const r = Math.max(0, strokeRadius - 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!interiorMask[y * width + x]) continue;
        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (dx * dx + dy * dy <= r * r + 0.5) {
              dilatedEdge[ny * width + nx] = 1;
            }
          }
        }
      }
    }
  }

  const cleanBgHex = settings.backgroundHex.replace('#', '');
  const bgNum = parseInt(cleanBgHex.length === 6 ? cleanBgHex : 'f7f6f2', 16);
  const bgR = (bgNum >> 16) & 255;
  const bgG = (bgNum >> 8) & 255;
  const bgB = bgNum & 255;

  const levels = settings.celShadowBands + 1;
  const toneCell = Math.max(4, Math.round(9 - settings.screentoneDensity * 5)); // 4..9 px cell
  const halfDiag = Math.hypot(width * 0.5, height * 0.5);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p = idx * 4;
      const a = alpha[idx];

      // Optional Manga Border / Focus Lines on background or foreground
      let overlayInk = false;
      if (settings.mangaOverlayEffect === 'manga_border') {
        const margin = Math.max(6, Math.round(Math.min(width, height) * 0.025));
        const thick = Math.max(2, Math.round(Math.min(width, height) * 0.005));
        const inOuterX = x >= margin && x < width - margin;
        const inOuterY = y >= margin && y < height - margin;
        const onFrame =
          inOuterX &&
          inOuterY &&
          (x < margin + thick ||
            x >= width - margin - thick ||
            y < margin + thick ||
            y >= height - margin - thick);
        if (onFrame) overlayInk = true;
      } else if (settings.mangaOverlayEffect === 'radial_focus') {
        const dx = x - width * 0.5;
        const dy = y - height * 0.5;
        const dist = Math.hypot(dx, dy);
        if (dist > halfDiag * 0.44) {
          const angle = Math.atan2(dy, dx);
          const spoke = Math.abs(Math.sin(angle * 48));
          const distFactor = (dist - halfDiag * 0.44) / Math.max(1, halfDiag * 0.56);
          if (spoke > 0.96 - distFactor * 0.14 && a < 20) {
            overlayInk = true;
          }
        }
      }

      if (a < 16 && !overlayInk) {
        linePass[p + 3] = 0;
        colorPass[p + 3] = 0;
        shadowPass[p + 3] = 0;
        if (settings.transparentBackground) {
          combined[p + 3] = 0;
        } else {
          combined[p] = bgR;
          combined[p + 1] = bgG;
          combined[p + 2] = bgB;
          combined[p + 3] = 255;
        }
        continue;
      }

      if (overlayInk) {
        linePass[p] = inkRgb[0];
        linePass[p + 1] = inkRgb[1];
        linePass[p + 2] = inkRgb[2];
        linePass[p + 3] = 255;
        combined[p] = inkRgb[0];
        combined[p + 1] = inkRgb[1];
        combined[p + 2] = inkRgb[2];
        combined[p + 3] = 255;
        continue;
      }

      let r = src[p];
      const g = src[p + 1];
      let b = src[p + 2];
      let gVal = g;
      const lum = luma[idx];

      // Optional micro-contrast sharpening so eye iris details, mouth, and hair strands stay crisp
      if (settings.detailSharpness > 0.04 && x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        const avgNeighbor =
          (luma[(y - 1) * width + x] +
            luma[(y + 1) * width + x] +
            luma[y * width + (x - 1)] +
            luma[y * width + (x + 1)]) *
          0.25;
        const delta = (lum - avgNeighbor) * (settings.detailSharpness * 0.55);
        r = clampByte(r + delta);
        gVal = clampByte(gVal + delta);
        b = clampByte(b + delta);
      }

      // Stepped Anime Cel Color Pass with Eye/Skin/Color-vibrance protection
      const band = Math.min(levels - 1, Math.floor((lum / 256) * levels));
      const inDeepShadow = lum < 86;
      const inShadow = lum < 138;
      // Gently compress banding contrast on saturated colors (eye iris, hair ribbons) so colors stay rich
      const maxC = Math.max(r, gVal, b);
      const minC = Math.min(r, gVal, b);
      const chroma = maxC - minC;
      const baseGain =
        settings.style === 'flat_color'
          ? 1.02
          : settings.animeShaderPreset === 'hard_cel'
          ? band === 0
            ? 0.72
            : 1.06
          : 0.78 + (band / Math.max(1, levels - 1)) * 0.3;
      const bandGain =
        settings.preserveFaceDetails && chroma > 38 ? 0.5 * baseGain + 0.5 : baseGain;

      let cr = r * bandGain;
      let cg = gVal * bandGain;
      let cb = b * bandGain;

      if (settings.preserveFaceDetails && chroma > 24 && settings.style !== 'monochrome_ink') {
        // Slight vibrance boost preserves anime eye iris hues and dyed hair tints
        const avgC = (cr + cg + cb) / 3;
        cr = avgC + (cr - avgC) * 1.12;
        cg = avgC + (cg - avgC) * 1.12;
        cb = avgC + (cb - avgC) * 1.12;
      }

      if (inShadow && settings.style !== 'flat_color') {
        if (settings.shadowTint === 'cool_violet') {
          cr = cr * 0.94 + 8;
          cg = cg * 0.91 + 4;
          cb = cb * 1.06 + 18;
        } else if (settings.shadowTint === 'warm_sepia') {
          cr = cr * 1.04 + 14;
          cg = cg * 0.96 + 6;
          cb = cb * 0.94 + 8;
        }
      }

      if (settings.animeShaderPreset === 'shojo_pastel') {
        cr = cr * 0.9 + 24;
        cg = cg * 0.9 + 20;
        cb = cb * 0.9 + 26;
      }

      if (isRimMask[idx]) {
        const lift = 34 * settings.rimGlow;
        cr += lift;
        cg += lift * 1.02;
        cb += lift * 1.15;
      }

      cr = clampByte(cr);
      cg = clampByte(cg);
      cb = clampByte(cb);

      colorPass[p] = cr;
      colorPass[p + 1] = cg;
      colorPass[p + 2] = cb;
      colorPass[p + 3] = a;

      // Shadow Pass
      if (inShadow) {
        shadowPass[p] = settings.shadowTint === 'warm_sepia' ? 76 : 44;
        shadowPass[p + 1] = settings.shadowTint === 'warm_sepia' ? 54 : 42;
        shadowPass[p + 2] = settings.shadowTint === 'cool_violet' ? 88 : 66;
        shadowPass[p + 3] = inDeepShadow ? 200 : 135;
      } else {
        shadowPass[p + 3] = 0;
      }

      const isOuterEdge = dilatedEdge[idx] === 1;
      const isFineInterior = !isOuterEdge && interiorMask[idx] === 1;

      if (isOuterEdge) {
        linePass[p] = inkRgb[0];
        linePass[p + 1] = inkRgb[1];
        linePass[p + 2] = inkRgb[2];
        linePass[p + 3] = 255;

        combined[p] = inkRgb[0];
        combined[p + 1] = inkRgb[1];
        combined[p + 2] = inkRgb[2];
        combined[p + 3] = 255;
        continue;
      }
      if (isFineInterior) {
        linePass[p] = inkRgb[0];
        linePass[p + 1] = inkRgb[1];
        linePass[p + 2] = inkRgb[2];
        linePass[p + 3] = settings.preserveFaceDetails ? 175 : 255;
      } else {
        linePass[p + 3] = 0;
      }

      // Combined pass by style / manga preset
      if (settings.style === 'monochrome_ink') {
        if (isFineInterior) {
          combined[p] = inkRgb[0];
          combined[p + 1] = inkRgb[1];
          combined[p + 2] = inkRgb[2];
          combined[p + 3] = 255;
        } else if (settings.animeShaderPreset === 'ink_outline') {
          // Clean Japanese pen-and-ink line-art look on bright paper with crisp shadow spot-blacks
          const hatch = (x + y) % 6 === 0;
          const val = lum > 134 ? 252 : lum > 82 ? (hatch ? 34 : 244) : 18;
          combined[p] = val;
          combined[p + 1] = val;
          combined[p + 2] = val;
          combined[p + 3] = a;
        } else {
          // Seinen/Gekiga high-contrast ink + diagonal cross-hatching in deep shadows
          const hatch =
            (x + y) % 5 === 0 || (settings.animeShaderPreset === 'seinen_gekiga' && (x - y + 4096) % 7 === 0);
          const val = lum > 152 ? 250 : lum > 96 ? 196 : lum > 58 ? (hatch ? 32 : 136) : 22;
          combined[p] = val;
          combined[p + 1] = val;
          combined[p + 2] = val;
          combined[p + 3] = a;
        }
      } else if (settings.style === 'screentone') {
        if (isFineInterior) {
          combined[p] = inkRgb[0];
          combined[p + 1] = inkRgb[1];
          combined[p + 2] = inkRgb[2];
          combined[p + 3] = 255;
        } else {
          // Rotated 45° Japanese Manga Amikake halftone dot screen
          const u = (x + y) * 0.7071;
          const v = (x - y) * 0.7071;
          const cu = ((u % toneCell) + toneCell) % toneCell - toneCell * 0.5;
          const cv = ((v % toneCell) + toneCell) % toneCell - toneCell * 0.5;
          const dist = Math.hypot(cu, cv);
          const darkness = Math.max(0, 1 - lum / 235);
          const dotR = darkness * (toneCell * 0.52);
          const inSolidBlack = lum < 44;
          const inDot = !inSolidBlack && lum < 198 && dist <= dotR;
          const val = inSolidBlack ? 18 : inDot ? 24 : lum > 198 ? 252 : 244;
          combined[p] = val;
          combined[p + 1] = val;
          combined[p + 2] = val;
          combined[p + 3] = a;
        }
      } else {
        // Colored Japanese Anime Cel / Film / Pastel: blend fine interior hairline so iris color & catchlights stay vivid
        if (isFineInterior) {
          const inkAlpha = settings.preserveFaceDetails ? 0.56 : 0.88;
          const inv = 1 - inkAlpha;
          combined[p] = clampByte(cr * inv + inkRgb[0] * inkAlpha);
          combined[p + 1] = clampByte(cg * inv + inkRgb[1] * inkAlpha);
          combined[p + 2] = clampByte(cb * inv + inkRgb[2] * inkAlpha);
          combined[p + 3] = a;
        } else {
          combined[p] = cr;
          combined[p + 1] = cg;
          combined[p + 2] = cb;
          combined[p + 3] = a;
        }
      }
    }
  }

  return { combined, linePass, colorPass, shadowPass };
}

/**
 * Transforms uploaded photographic backgrounds into Japanese anime painted scenes
 * or Japanese B&W manga screentone backgrounds so characters blend seamlessly.
 */
export function stylizeBackgroundForAnime(
  width: number,
  height: number,
  bgRgba: Uint8ClampedArray,
  settings: RasterRenderSettings
): { combined: Uint8ClampedArray; colorPass: Uint8ClampedArray } {
  if (!settings.stylizeBackground || settings.backgroundHarmony === 'raw_photo') {
    return { combined: bgRgba, colorPass: bgRgba };
  }

  if (settings.backgroundHarmony === 'manga_tone' || settings.style === 'monochrome_ink' || settings.style === 'screentone') {
    const mangaPasses = renderJapaneseAnimeMangaPasses(width, height, bgRgba, {
      ...settings,
      style: settings.style === 'monochrome_ink' ? 'monochrome_ink' : 'screentone',
      exteriorLineWidth: Math.max(1, Math.min(2, settings.exteriorLineWidth)),
      internalEdgeThreshold: Math.min(0.55, settings.internalEdgeThreshold + 0.08),
      mangaOverlayEffect: 'none',
      transparentBackground: false,
    });
    return { combined: mangaPasses.combined, colorPass: mangaPasses.colorPass };
  }

  // 'anime_paint': 3x3 smoothing + vibrant Makoto-style painted color harmony + subtle ink edges
  const out = new Uint8ClampedArray(bgRgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const idx = (ny * width + nx) * 4;
          sr += bgRgba[idx];
          sg += bgRgba[idx + 1];
          sb += bgRgba[idx + 2];
          cnt++;
        }
      }
      const r = sr / cnt;
      const g = sg / cnt;
      const b = sb / cnt;
      // Softly posterize + lift sky/foliage vibrancy toward painted anime cel background
      const q = 18;
      const pr = Math.round(r / q) * q;
      const pg = Math.round(g / q) * q;
      const pb = Math.round(b / q) * q;
      const avg = (pr + pg + pb) / 3;
      const satBoost = 1.22;
      const dst = (y * width + x) * 4;
      out[dst] = clampByte(avg + (pr - avg) * satBoost + 4);
      out[dst + 1] = clampByte(avg + (pg - avg) * satBoost + 5);
      out[dst + 2] = clampByte(avg + (pb - avg) * satBoost + 10);
      out[dst + 3] = 255;
    }
  }
  return { combined: out, colorPass: out };
}
