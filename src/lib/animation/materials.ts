import * as THREE from 'three';
import type { MaterialAppearanceSettings, MaterialMode } from '../../../shared/studio';
import type { PbrTextureSlotBinding } from '../../../shared/characters';

export interface OriginalMaterialSnapshot {
  material: THREE.Material | THREE.Material[];
}

export type OriginalMaterialCache = WeakMap<THREE.Mesh, OriginalMaterialSnapshot>;

export function cacheOriginalMaterials(root: THREE.Object3D, cache: OriginalMaterialCache): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && !cache.has(mesh)) {
      const cloned = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
      cache.set(mesh, { material: cloned });
    }
  });
}

export function restoreOriginalMaterials(root: THREE.Object3D, cache: OriginalMaterialCache): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const orig = cache.get(mesh);
      if (orig) {
        mesh.material = Array.isArray(orig.material)
          ? orig.material.map((m) => m.clone())
          : orig.material.clone();
      }
    }
  });
}

export function applyStudioMaterialMode(
  root: THREE.Object3D,
  cache: OriginalMaterialCache,
  settings: MaterialAppearanceSettings
): void {
  cacheOriginalMaterials(root, cache);
  restoreOriginalMaterials(root, cache);

  if (settings.mode === 'original' && settings.tintHex.toLowerCase() === '#ffffff') {
    return;
  }

  const tintColor = new THREE.Color(settings.tintHex || '#ffffff');

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const nextList = list.map((mat) => buildModeMaterial(mat, settings.mode, tintColor, settings));
    mesh.material = Array.isArray(mesh.material) ? nextList : nextList[0];
  });
}

function buildModeMaterial(
  baseMat: THREE.Material,
  mode: MaterialMode,
  tintColor: THREE.Color,
  settings: MaterialAppearanceSettings
): THREE.Material {
  const std = baseMat as THREE.MeshStandardMaterial;
  const hasVertexColors = Boolean((std as THREE.Material).vertexColors);
  const existingMap = std.map ?? null;
  const baseColor = std.color ? std.color.clone().multiply(tintColor) : tintColor.clone();

  if (mode === 'original') {
    const clone = baseMat.clone() as THREE.MeshStandardMaterial;
    if (clone.color) clone.color.copy(baseColor);
    if (typeof clone.roughness === 'number') clone.roughness = settings.roughness;
    if (typeof clone.metalness === 'number') clone.metalness = settings.metalness;
    return clone;
  }

  if (mode === 'toon') {
    const toon = new THREE.MeshToonMaterial({
      name: `${baseMat.name || 'Mat'}_Toon`,
      color: baseColor,
      map: existingMap,
      vertexColors: hasVertexColors,
      side: baseMat.side,
    });
    return toon;
  }

  if (mode === 'clay') {
    return new THREE.MeshStandardMaterial({
      name: `${baseMat.name || 'Mat'}_Clay`,
      color: new THREE.Color('#d8dce6').multiply(tintColor),
      roughness: 0.78,
      metalness: 0.02,
      side: baseMat.side,
    });
  }

  // wire / line reference mode
  return new THREE.MeshBasicMaterial({
    name: `${baseMat.name || 'Mat'}_Wire`,
    color: new THREE.Color('#e6a1b0'),
    wireframe: true,
    side: baseMat.side,
  });
}

export async function applyPbrTextureBindings(
  root: THREE.Object3D,
  cache: OriginalMaterialCache,
  bindings: PbrTextureSlotBinding[]
): Promise<{ appliedCount: number; warnings: string[] }> {
  cacheOriginalMaterials(root, cache);
  restoreOriginalMaterials(root, cache);

  if (bindings.length === 0) {
    return { appliedCount: 0, warnings: [] };
  }

  const loader = new THREE.TextureLoader();
  const warnings: string[] = [];
  let appliedCount = 0;

  for (const binding of bindings) {
    let tex: THREE.Texture;
    try {
      tex = await loader.loadAsync(binding.dataUrlOrAssetId);
    } catch {
      warnings.push(`Failed to decode texture ${binding.fileName}.`);
      continue;
    }

    tex.colorSpace = binding.channel === 'baseColor' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (binding.flipY === 'flip') tex.flipY = true;
    else if (binding.flipY === 'no-flip') tex.flipY = false;

    if (binding.uvChannel === 'uv1') tex.channel = 1;
    else if (binding.uvChannel === 'uv0') tex.channel = 0;

    tex.needsUpdate = true;

    let matchedSlot = false;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry;
      if (binding.uvChannel === 'uv1' && geo && !geo.getAttribute('uv1') && !geo.getAttribute('uv2')) {
        warnings.push(`${mesh.name || 'Mesh'} has no UV1 attribute; falling back may be needed.`);
      }

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat, idx) => {
        const slotName = mat.name && mat.name.trim() ? mat.name.trim() : `${mesh.name || 'Mesh'}_Mat_${idx}`;
        const matches =
          binding.targetMaterialSlot === '__all_atlas__' ||
          binding.targetMaterialSlot === slotName ||
          (binding.targetMaterialSlot === '__auto__' &&
            (mats.length === 1 || binding.fileName.toLowerCase().includes(slotName.toLowerCase())));

        if (!matches) return;
        matchedSlot = true;

        const std = mat as THREE.MeshStandardMaterial;
        // Preserve existing UV repeat/offset when present on source map
        const sourceMap = std.map || std.normalMap || std.roughnessMap || std.metalnessMap;
        if (sourceMap) {
          tex.repeat.copy(sourceMap.repeat);
          tex.offset.copy(sourceMap.offset);
          tex.rotation = sourceMap.rotation;
          if (binding.flipY === 'auto') tex.flipY = sourceMap.flipY;
          if (binding.uvChannel === 'auto') tex.channel = sourceMap.channel;
        }

        if (binding.channel === 'baseColor') {
          std.map = tex;
        } else if (binding.channel === 'normal') {
          std.normalMap = tex;
          if (std.normalScale) {
            std.normalScale.set(1, binding.normalY === 'directx' ? -1 : 1);
          }
        } else if (binding.channel === 'roughness') {
          std.roughnessMap = tex;
        } else if (binding.channel === 'metallic') {
          std.metalnessMap = tex;
        }
        std.needsUpdate = true;
        appliedCount += 1;
      });
    });

    if (!matchedSlot) {
      warnings.push(
        `No material slot matched "${binding.targetMaterialSlot}" for ${binding.fileName}. Select an explicit slot or All-Atlas mode.`
      );
    }
  }

  return { appliedCount, warnings };
}
