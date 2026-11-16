import * as THREE from 'three';
import { zipSync, strToU8 } from 'fflate';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CameraPreset } from '../../../shared/studio';
import type {
  CameraFramingPreset,
  RasterOutputRecord,
  RasterRenderSettings,
} from '../../../shared/pose-raster';
import { collectSkeletonBones, mapBonesToRoles } from './rigInspect';

export interface RasterPassesUint8 {
  combined: Uint8ClampedArray;
  linePass: Uint8ClampedArray;
  colorPass: Uint8ClampedArray;
  shadowPass: Uint8ClampedArray;
}

/**
 * Pure non-destructive raster/manga image pass generator operating on RGBA pixel buffers.
 * Computes cel-quantized color pass, shadow-band pass, edge-line ink pass, and composite/screentone output.
 */
export function processRgbaPixelsToMangaPasses(
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

  const bgRgb = hexToRgb(settings.backgroundHex);
  const levels = settings.celShadowBands + 1;
  const edgeThreshold = Math.max(12, Math.round((1 - settings.internalEdgeThreshold) * 95));
  const lineWeight = Math.max(0, Math.round(settings.exteriorLineWidth));

  // Precompute luminance & alpha arrays for Sobel gradient edge detection
  const luma = new Float32Array(width * height);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    alpha[i] = src[p + 3];
    luma[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p = idx * 4;
      const a = alpha[idx];

      if (a < 10) {
        // Background pixel
        linePass[p + 3] = 0;
        colorPass[p + 3] = 0;
        shadowPass[p + 3] = 0;
        if (settings.transparentBackground) {
          combined[p] = 0;
          combined[p + 1] = 0;
          combined[p + 2] = 0;
          combined[p + 3] = 0;
        } else {
          combined[p] = bgRgb[0];
          combined[p + 1] = bgRgb[1];
          combined[p + 2] = bgRgb[2];
          combined[p + 3] = 255;
        }
        continue;
      }

      const r = src[p];
      const g = src[p + 1];
      const b = src[p + 2];
      const lum = luma[idx];

      // 1. Flat / Cel quantized color pass
      const band = Math.min(levels - 1, Math.floor((lum / 256) * levels));
      const bandGain = settings.style === 'flat_color' ? 1.0 : 0.62 + (band / Math.max(1, levels - 1)) * 0.42;
      const cr = clampByte(r * bandGain);
      const cg = clampByte(g * bandGain);
      const cb = clampByte(b * bandGain);
      colorPass[p] = cr;
      colorPass[p + 1] = cg;
      colorPass[p + 2] = cb;
      colorPass[p + 3] = a;

      // 2. Shadow band pass (ink-tint shadow mask where luminance falls in lower bands)
      const inShadow = lum < (255 * 0.48);
      if (inShadow) {
        shadowPass[p] = 38;
        shadowPass[p + 1] = 42;
        shadowPass[p + 2] = 66;
        shadowPass[p + 3] = 170;
      } else {
        shadowPass[p + 3] = 0;
      }

      // 3. Exterior + internal edge ink detection
      let isEdge = false;
      if (lineWeight > 0 && x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        const aUp = alpha[(y - 1) * width + x];
        const aDn = alpha[(y + 1) * width + x];
        const aLt = alpha[y * width + (x - 1)];
        const aRt = alpha[y * width + (x + 1)];
        const silhouetteEdge = aUp < 128 || aDn < 128 || aLt < 128 || aRt < 128;

        const gx = Math.abs(luma[y * width + (x + 1)] - luma[y * width + (x - 1)]);
        const gy = Math.abs(luma[(y + 1) * width + x] - luma[(y - 1) * width + x]);
        const internalEdge = gx + gy > edgeThreshold;
        isEdge = silhouetteEdge || internalEdge;
      }

      if (isEdge) {
        linePass[p] = 18;
        linePass[p + 1] = 20;
        linePass[p + 2] = 30;
        linePass[p + 3] = 255;
      } else {
        linePass[p + 3] = 0;
      }

      // 4. Composite combined raster / manga output
      if (isEdge) {
        combined[p] = 18;
        combined[p + 1] = 20;
        combined[p + 2] = 30;
        combined[p + 3] = 255;
      } else if (settings.style === 'monochrome_ink') {
        const mono = lum > 138 ? 248 : lum > 82 ? 175 : 44;
        combined[p] = mono;
        combined[p + 1] = mono;
        combined[p + 2] = mono;
        combined[p + 3] = a;
      } else if (settings.style === 'screentone') {
        const dotPeriod = Math.max(3, Math.round(7 - settings.screentoneDensity * 4));
        const inDot = (x % dotPeriod === 0 && y % dotPeriod === 0) && lum < 165;
        const toneVal = inDot ? 36 : lum > 148 ? 250 : 210;
        combined[p] = toneVal;
        combined[p + 1] = toneVal;
        combined[p + 2] = toneVal;
        combined[p + 3] = a;
      } else {
        combined[p] = cr;
        combined[p + 1] = cg;
        combined[p + 2] = cb;
        combined[p + 3] = a;
      }
    }
  }

  return { combined, linePass, colorPass, shadowPass };
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 6 ? clean : 'f7f6f2', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Pure Porter-Duff source-over alpha compositing of two equally sized RGBA buffers.
 */
export function compositeRgbaOver(
  fg: Uint8ClampedArray,
  bg: Uint8ClampedArray
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(fg.length);
  for (let i = 0; i < fg.length; i += 4) {
    const fa = fg[i + 3] / 255;
    if (fa >= 0.999) {
      out[i] = fg[i];
      out[i + 1] = fg[i + 1];
      out[i + 2] = fg[i + 2];
      out[i + 3] = 255;
    } else if (fa <= 0.001) {
      out[i] = bg[i];
      out[i + 1] = bg[i + 1];
      out[i + 2] = bg[i + 2];
      out[i + 3] = bg[i + 3];
    } else {
      const ba = bg[i + 3] / 255;
      const outA = fa + ba * (1 - fa);
      if (outA <= 0.001) {
        out[i + 3] = 0;
      } else {
        out[i] = clampByte((fg[i] * fa + bg[i] * ba * (1 - fa)) / outA);
        out[i + 1] = clampByte((fg[i + 1] * fa + bg[i + 1] * ba * (1 - fa)) / outA);
        out[i + 2] = clampByte((fg[i + 2] * fa + bg[i + 2] * ba * (1 - fa)) / outA);
        out[i + 3] = clampByte(outA * 255);
      }
    }
  }
  return out;
}

/**
 * Pure opaque bounding-box center (normalized 0..1) of an RGBA buffer.
 * Used to snap the 2D character move gizmo directly onto the rasterized character.
 */
export function computeRgbaOpaqueCenter(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): { x: number; y: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = rgba[(y * width + x) * 4 + 3];
      if (a >= 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { x: 0.5, y: 0.5 };
  }
  return {
    x: Number((((minX + maxX) * 0.5) / Math.max(1, width)).toFixed(4)),
    y: Number((((minY + maxY) * 0.5) / Math.max(1, height)).toFixed(4)),
  };
}

/**
 * Pure placement math matching CSS `translate(offsetX*100%, offsetY*100%) scale(scale)`
 * around center `(0.5, 0.5)`.
 */
export function computeForegroundPlacementRect(
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
  scale = 1
): { drawX: number; drawY: number; drawW: number; drawH: number } {
  const s = Math.max(0.35, Math.min(2.5, Number.isFinite(scale) ? scale : 1));
  const ox = Math.max(-1, Math.min(1, Number.isFinite(offsetX) ? offsetX : 0));
  const oy = Math.max(-1, Math.min(1, Number.isFinite(offsetY) ? offsetY : 0));
  const drawW = width * s;
  const drawH = height * s;
  const drawX = width * (0.5 + ox) - drawW * 0.5;
  const drawY = height * (0.5 + oy) - drawH * 0.5;
  return { drawX, drawY, drawW, drawH };
}

/**
 * Pure RGBA layer compositor that translates & scales `fg` while keeping `bg` fixed.
 */
export function compositePositionedRgbaOver(
  fg: Uint8ClampedArray,
  bg: Uint8ClampedArray,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
  scale = 1
): Uint8ClampedArray {
  const s = Math.max(0.35, Math.min(2.5, Number.isFinite(scale) ? scale : 1));
  const ox = Math.max(-1, Math.min(1, Number.isFinite(offsetX) ? offsetX : 0));
  const oy = Math.max(-1, Math.min(1, Number.isFinite(offsetY) ? offsetY : 0));

  const shiftedFg = new Uint8ClampedArray(fg.length);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const shiftPxX = ox * width;
  const shiftPxY = oy * height;

  for (let y = 0; y < height; y++) {
    const sy = Math.round(cy + (y - cy - shiftPxY) / s);
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x++) {
      const sx = Math.round(cx + (x - cx - shiftPxX) / s);
      if (sx < 0 || sx >= width) continue;
      const srcIdx = (sy * width + sx) * 4;
      const dstIdx = (y * width + x) * 4;
      shiftedFg[dstIdx] = fg[srcIdx];
      shiftedFg[dstIdx + 1] = fg[srcIdx + 1];
      shiftedFg[dstIdx + 2] = fg[srcIdx + 2];
      shiftedFg[dstIdx + 3] = fg[srcIdx + 3];
    }
  }

  return compositeRgbaOver(shiftedFg, bg);
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load raster layer image'));
    img.src = dataUrl;
  });
}

/**
 * Browser offscreen canvas compositor returning a PNG dataUrl with the rasterized
 * foreground positioned & scaled over the fixed background.
 */
export async function composeRasterRecordExportDataUrl(
  rec: RasterOutputRecord,
  layer: 'combined' | 'line' | 'color' | 'shadow' = 'combined'
): Promise<string> {
  const offsetX = rec.foregroundOffsetX ?? 0;
  const offsetY = rec.foregroundOffsetY ?? 0;
  const scale = rec.foregroundScale ?? 1;
  const isUnmoved = Math.abs(offsetX) < 1e-4 && Math.abs(offsetY) < 1e-4 && Math.abs(scale - 1) < 1e-4;

  const fallbackMap = {
    combined: rec.combinedDataUrl,
    line: rec.linePassDataUrl,
    color: rec.colorPassDataUrl,
    shadow: rec.shadowPassDataUrl,
  };
  const directUrl = fallbackMap[layer];
  if (isUnmoved && directUrl) return directUrl;

  const canvas = document.createElement('canvas');
  canvas.width = rec.width;
  canvas.height = rec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return directUrl || rec.combinedDataUrl;

  if (layer === 'combined') {
    if (rec.backgroundDataUrl) {
      const bgImg = await loadImageElement(rec.backgroundDataUrl).catch(() => null);
      if (bgImg) ctx.drawImage(bgImg, 0, 0, rec.width, rec.height);
    }
    const fgUrl = rec.foregroundDataUrl || rec.combinedDataUrl;
    const fgImg = await loadImageElement(fgUrl).catch(() => null);
    if (fgImg) {
      const rect = computeForegroundPlacementRect(rec.width, rec.height, offsetX, offsetY, scale);
      ctx.drawImage(fgImg, rect.drawX, rect.drawY, rect.drawW, rect.drawH);
    }
    return canvas.toDataURL('image/png');
  }

  if (!directUrl) return rec.combinedDataUrl;
  const layerImg = await loadImageElement(directUrl).catch(() => null);
  if (layerImg) {
    const rect = computeForegroundPlacementRect(rec.width, rec.height, offsetX, offsetY, scale);
    ctx.drawImage(layerImg, rect.drawX, rect.drawY, rect.drawW, rect.drawH);
  }
  return canvas.toDataURL('image/png');
}

export interface RasterCameraAdjustments {
  cameraFraming?: CameraFramingPreset;
  cameraZoom?: number;
  cameraOrbitYawDeg?: number;
  cameraOrbitPitchDeg?: number;
  cameraRollDeg?: number;
  cameraPanX?: number;
  cameraPanY?: number;
  cameraFov?: number;
}

export function computeCameraPresetForSubject(
  subjectRoot: THREE.Object3D,
  preset: CameraPreset,
  camAdjust?: RasterCameraAdjustments
): { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number } {
  subjectRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(subjectRoot);
  const bones = collectSkeletonBones(subjectRoot);
  const boneBox = new THREE.Box3();
  const tmpPos = new THREE.Vector3();
  for (const b of bones) {
    b.getWorldPosition(tmpPos);
    boneBox.expandByPoint(tmpPos);
  }
  if (!boneBox.isEmpty()) {
    const boneH = Math.max(0.8, boneBox.max.y - boneBox.min.y);
    // Tight realistic margins for hair/crown above Head bone and soles below Foot/Toe bones
    boneBox.min.x -= boneH * 0.14;
    boneBox.max.x += boneH * 0.14;
    boneBox.min.z -= boneH * 0.14;
    boneBox.max.z += boneH * 0.14;
    boneBox.min.y -= boneH * 0.05;
    boneBox.max.y += boneH * 0.14;
    box.copy(boneBox);
  } else if (box.isEmpty()) {
    box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.7, 0.5));
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const roles = mapBonesToRoles(bones);
  const headBone = roles.head || roles.neck;
  const chestBone = roles.chest || roles.spine || roles.hips;
  const hipsBone = roles.hips || roles.spine;
  const framing: CameraFramingPreset = camAdjust?.cameraFraming ?? 'full';
  const fov = THREE.MathUtils.clamp(camAdjust?.cameraFov ?? 38, 18, 75);
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(fov * 0.5));

  const maxDim = Math.max(size.x, size.y, size.z, 1.0);
  const fullSpanHalf = Math.max(size.y * 0.5, size.x * 0.52);
  let anchor = center.clone();
  // Exact frustum fit fills ~87% of vertical frame so full body fits cleanly without shrinking eyes/hair
  let dist = (fullSpanHalf / tanHalfFov) * 1.12;

  if (framing === 'wide') {
    dist = (fullSpanHalf / tanHalfFov) * 1.48;
  } else if (framing === 'knee') {
    if (hipsBone && chestBone) {
      const hipPos = new THREE.Vector3();
      const chPos = new THREE.Vector3();
      hipsBone.getWorldPosition(hipPos);
      chestBone.getWorldPosition(chPos);
      anchor.copy(hipPos).lerp(chPos, 0.48);
    } else {
      anchor.y = box.min.y + size.y * 0.58;
    }
    dist = ((size.y * 0.38) / tanHalfFov) * 1.12;
  } else if (framing === 'face') {
    if (headBone) {
      headBone.getWorldPosition(anchor);
      anchor.y += size.y * 0.035;
    } else {
      anchor.y = box.min.y + size.y * 0.87;
    }
    dist = Math.max(0.28, ((size.y * 0.14) / tanHalfFov) * 1.12);
  } else if (framing === 'bust') {
    if (headBone && chestBone) {
      const hPos = new THREE.Vector3();
      const cPos = new THREE.Vector3();
      headBone.getWorldPosition(hPos);
      chestBone.getWorldPosition(cPos);
      anchor.copy(cPos).lerp(hPos, 0.62);
    } else {
      anchor.y = box.min.y + size.y * 0.77;
    }
    dist = Math.max(0.4, ((size.y * 0.24) / tanHalfFov) * 1.12);
  } else if (framing === 'waist') {
    if (chestBone) {
      chestBone.getWorldPosition(anchor);
    } else {
      anchor.y = box.min.y + size.y * 0.64;
    }
    dist = Math.max(0.58, ((size.y * 0.34) / tanHalfFov) * 1.12);
  }

  const isFullSpan = framing === 'full' || framing === 'wide';
  let baseOffset: THREE.Vector3;
  if (preset === 'front') {
    baseOffset = new THREE.Vector3(0, isFullSpan ? 0.05 : 0.015, dist);
  } else if (preset === 'side') {
    baseOffset = new THREE.Vector3(dist, isFullSpan ? 0.05 : 0.015, 0);
  } else if (preset === 'back') {
    baseOffset = new THREE.Vector3(0, isFullSpan ? 0.05 : 0.015, -dist);
  } else {
    const yawFactor = isFullSpan ? 0.38 : 0.26;
    const elevFactor = isFullSpan ? size.y * 0.09 : dist * 0.07;
    baseOffset = new THREE.Vector3(dist * yawFactor, elevFactor, dist * 0.92);
  }

  const zoom = THREE.MathUtils.clamp(camAdjust?.cameraZoom ?? 1.0, 0.25, 8.0);
  baseOffset.multiplyScalar(1 / zoom);

  const yawRad = THREE.MathUtils.degToRad(camAdjust?.cameraOrbitYawDeg ?? 0);
  const pitchRad = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(camAdjust?.cameraOrbitPitchDeg ?? 0, -60, 60)
  );
  const rollRad = THREE.MathUtils.degToRad(camAdjust?.cameraRollDeg ?? 0);

  if (Math.abs(yawRad) > 1e-5) {
    baseOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
  }
  const viewDirBeforePitch = baseOffset.clone().normalize();
  const rightAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDirBeforePitch);
  if (rightAxis.lengthSq() < 1e-5) rightAxis.set(1, 0, 0);
  else rightAxis.normalize();

  if (Math.abs(pitchRad) > 1e-5) {
    baseOffset.applyAxisAngle(rightAxis, pitchRad);
  }

  const panScale = isFullSpan ? maxDim * 0.55 : dist * 0.45;
  const panX = THREE.MathUtils.clamp(camAdjust?.cameraPanX ?? 0, -1.5, 1.5) * panScale;
  const panY = THREE.MathUtils.clamp(camAdjust?.cameraPanY ?? 0, -1.5, 1.5) * panScale;

  const target = anchor
    .clone()
    .addScaledVector(rightAxis, panX)
    .add(new THREE.Vector3(0, panY, 0));
  const position = target.clone().add(baseOffset);
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(rollRad) > 1e-5) {
    const forward = target.clone().sub(position).normalize();
    up.applyAxisAngle(forward, rollRad).normalize();
  }

  return { position, target, up, fov };
}

export function packFilesToZip(
  files: Record<string, Uint8Array | string>
): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    input[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(input, { level: 6 });
}

export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function exportCharacterToGlb(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[] = []
): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(root, {
    binary: true,
    animations,
  });
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

/**
 * Genuine skeletal BVH exporter for animated poses/clips on humanoid rigs.
 */
export function exportPoseOrClipToBvh(
  root: THREE.Object3D,
  frameCount: number = 2,
  frameTimeSec: number = 1 / 30
): string {
  const bones = collectSkeletonBones(root);
  if (bones.length === 0) {
    throw new Error('Cannot export BVH: target character has no skeleton bones.');
  }

  const rootBone = bones.find((b) => !(b.parent && (b.parent as THREE.Bone).isBone)) || bones[0];
  const lines: string[] = ['HIERARCHY'];
  const orderedBones: THREE.Bone[] = [];

  function writeJoint(bone: THREE.Bone, depth: number, isRoot: boolean) {
    const pad = '  '.repeat(depth);
    const cleanName = (bone.name || 'Joint').replace(/\s+/g, '_');
    lines.push(`${pad}${isRoot ? 'ROOT' : 'JOINT'} ${cleanName}`);
    lines.push(`${pad}{`);
    lines.push(
      `${pad}  OFFSET ${bone.position.x.toFixed(4)} ${bone.position.y.toFixed(4)} ${bone.position.z.toFixed(4)}`
    );
    if (isRoot) {
      lines.push(`${pad}  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation`);
    } else {
      lines.push(`${pad}  CHANNELS 3 Zrotation Xrotation Yrotation`);
    }
    orderedBones.push(bone);
    const childBones = bone.children.filter((c): c is THREE.Bone => (c as THREE.Bone).isBone);
    if (childBones.length === 0) {
      lines.push(`${pad}  End Site`);
      lines.push(`${pad}  {`);
      lines.push(`${pad}    OFFSET 0.0000 0.0500 0.0000`);
      lines.push(`${pad}  }`);
    } else {
      for (const child of childBones) {
        writeJoint(child, depth + 1, false);
      }
    }
    lines.push(`${pad}}`);
  }

  writeJoint(rootBone, 0, true);
  lines.push('MOTION');
  lines.push(`Frames: ${frameCount}`);
  lines.push(`Frame Time: ${frameTimeSec.toFixed(6)}`);

  const euler = new THREE.Euler();
  const radToDeg = 180 / Math.PI;
  const rowValues: string[] = [];
  for (let i = 0; i < orderedBones.length; i++) {
    const b = orderedBones[i];
    euler.setFromQuaternion(b.quaternion, 'ZXY');
    if (i === 0) {
      rowValues.push(
        b.position.x.toFixed(4),
        b.position.y.toFixed(4),
        b.position.z.toFixed(4)
      );
    }
    rowValues.push(
      (euler.z * radToDeg).toFixed(3),
      (euler.x * radToDeg).toFixed(3),
      (euler.y * radToDeg).toFixed(3)
    );
  }
  const rowStr = rowValues.join(' ');
  for (let f = 0; f < frameCount; f++) {
    lines.push(rowStr);
  }

  return lines.join('\n');
}
