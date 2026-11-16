import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import type {
  ModelFileFormat,
  PbrTextureSlotBinding,
  TextureMapChannel,
} from '../../../shared/characters';
import { detectModelFormat, validateBundleSizes } from '../../../shared/characters';

export interface LoadedModelResult {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  format: ModelFileFormat;
  missingResources: string[];
  warnings: string[];
}

export interface ClassifiedTextureFolderResult {
  imageFiles: Array<{ fileName: string; relativePath: string; channel: TextureMapChannel }>;
  materialCompanionFiles: string[];
}

export function normalizeResourcePath(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .split('?')[0]
    .split('#')[0]
    .trim()
    .toLowerCase();
}

export function inferTextureChannelFromName(fileName: string): TextureMapChannel | null {
  const lower = fileName.toLowerCase();
  if (!/\.(png|jpe?g|webp|tga|bmp)$/i.test(lower)) return null;
  if (/(normal|_nrm|_norm|bump|_ddn|_n\.)/i.test(lower)) return 'normal';
  if (/(roughness|_rough|_rgh|_gloss)/i.test(lower)) return 'roughness';
  if (/(metallic|_metal|_met\.)/i.test(lower)) return 'metallic';
  if (/(albedo|diffuse|basecolor|base_color|_col|_color|_diff|_bc\.|_d\.)/i.test(lower)) {
    return 'baseColor';
  }
  return 'baseColor';
}

export function autoClassifyTextureFolderFiles(
  files: Array<{ name: string; webkitRelativePath?: string }>
): ClassifiedTextureFolderResult {
  const imageFiles: ClassifiedTextureFolderResult['imageFiles'] = [];
  const materialCompanionFiles: string[] = [];

  for (const f of files) {
    const rel = normalizeResourcePath(f.webkitRelativePath || f.name);
    const channel = inferTextureChannelFromName(f.name);
    if (channel) {
      imageFiles.push({ fileName: f.name, relativePath: rel, channel });
    } else if (/\.(mtl|bin)$/i.test(f.name)) {
      materialCompanionFiles.push(f.name);
    }
  }

  return { imageFiles, materialCompanionFiles };
}

export function buildAutoPbrBindingsFromFolderFiles(files: File[]): {
  bindings: PbrTextureSlotBinding[];
  revokeUrls: () => void;
} {
  const bindings: PbrTextureSlotBinding[] = [];
  const urls: string[] = [];
  const seenChannels = new Set<TextureMapChannel>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const channel = inferTextureChannelFromName(file.name);
    if (!channel) continue;
    // Prefer up to 1 auto-fallback binding per channel if needed, or per filename token
    if (seenChannels.has(channel) && files.length > 4) continue;
    seenChannels.add(channel);
    const url = URL.createObjectURL(file);
    urls.push(url);
    bindings.push({
      id: `folder-${channel}-${i}-${Date.now()}`,
      channel,
      fileName: file.name,
      dataUrlOrAssetId: url,
      targetMaterialSlot: '__auto__',
      uvChannel: 'auto',
      flipY: 'auto',
      normalY: 'opengl',
    });
  }

  return {
    bindings,
    revokeUrls: () => {
      for (const u of urls) URL.revokeObjectURL(u);
    },
  };
}

/**
 * Loads GLB, glTF, FBX, or static OBJ files along with companion resources (textures/mats folder, .bin, .mtl)
 * cleanly using a path- and basename-indexed Three.js LoadingManager.
 */
export async function loadCharacterBundleFromFiles(
  primaryFile: File,
  companionFiles: File[] = []
): Promise<LoadedModelResult> {
  const allFiles = [primaryFile, ...companionFiles];
  const sizeCheck = validateBundleSizes(
    allFiles.map((f) => ({ name: f.name, sizeBytes: f.size }))
  );
  if (!sizeCheck.ok) {
    throw new Error((sizeCheck as { ok: false; error: string }).error);
  }

  const format = detectModelFormat(primaryFile.name);
  if (!format) {
    throw new Error(`Unsupported file format for "${primaryFile.name}". Use .glb, .gltf, .fbx, or .obj.`);
  }

  const objectUrls: string[] = [];
  const pathLookup = new Map<string, string>();
  const baseNameLookup = new Map<string, string>();
  const missingResources: string[] = [];

  for (const file of allFiles) {
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    const base = normalizeResourcePath(file.name);
    baseNameLookup.set(base, url);
    pathLookup.set(base, url);

    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (rel) {
      const normalizedRel = normalizeResourcePath(rel);
      pathLookup.set(normalizedRel, url);
      // Also index without top-level folder prefix (e.g., "textures/skin.png" when user picked "MyChar/textures/skin.png")
      const firstSlash = normalizedRel.indexOf('/');
      if (firstSlash >= 0) {
        pathLookup.set(normalizedRel.slice(firstSlash + 1), url);
      }
    }
  }

  const resolveUrl = (requestedUrl: string): string | null => {
    const normalized = normalizeResourcePath(requestedUrl);
    if (pathLookup.has(normalized)) return pathLookup.get(normalized)!;
    const baseName = normalized.split('/').pop() ?? '';
    if (baseName && baseNameLookup.has(baseName)) return baseNameLookup.get(baseName)!;
    return null;
  };

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((requestedUrl) => {
    if (requestedUrl.startsWith('blob:') || requestedUrl.startsWith('data:')) {
      return requestedUrl;
    }
    const match = resolveUrl(requestedUrl);
    if (match) return match;
    const baseName = normalizeResourcePath(requestedUrl).split('/').pop() ?? '';
    if (baseName) missingResources.push(baseName);
    return requestedUrl;
  });

  const primaryUrl = baseNameLookup.get(normalizeResourcePath(primaryFile.name))!;
  const warnings: string[] = [];

  try {
    if (format === 'glb' || format === 'gltf') {
      const loader = new GLTFLoader(manager);
      const gltf = await loader.loadAsync(primaryUrl);
      const group = new THREE.Group();
      group.name = primaryFile.name;
      group.add(gltf.scene);
      return {
        root: group,
        clips: gltf.animations || [],
        format,
        missingResources: Array.from(new Set(missingResources)),
        warnings,
      };
    }

    if (format === 'fbx') {
      const loader = new FBXLoader(manager);
      const fbx = await loader.loadAsync(primaryUrl);
      // Normalize centimetric Mixamo/FBX scale gently if huge
      const box = new THREE.Box3().setFromObject(fbx);
      const size = new THREE.Vector3();
      box.getSize(size);
      if (size.y > 20) {
        fbx.scale.multiplyScalar(0.01);
        warnings.push('Normalized centimetric FBX scale (0.01x) for studio meters.');
      }
      const group = new THREE.Group();
      group.name = primaryFile.name;
      group.add(fbx);
      return {
        root: group,
        clips: fbx.animations || [],
        format,
        missingResources: Array.from(new Set(missingResources)),
        warnings,
      };
    }

    // OBJ (plus optional .mtl companion if uploaded in folder)
    const objLoader = new OBJLoader(manager);
    const mtlCompanion = companionFiles.find((f) => f.name.toLowerCase().endsWith('.mtl'));
    if (mtlCompanion) {
      const mtlUrl = baseNameLookup.get(normalizeResourcePath(mtlCompanion.name));
      if (mtlUrl) {
        try {
          const mtlLoader = new MTLLoader(manager);
          const materials = await mtlLoader.loadAsync(mtlUrl);
          materials.preload();
          objLoader.setMaterials(materials);
        } catch {
          warnings.push(`Could not parse companion MTL "${mtlCompanion.name}".`);
        }
      }
    }
    const obj = await objLoader.loadAsync(primaryUrl);
    warnings.push('OBJ meshes contain no skeleton or skin weights.');
    const group = new THREE.Group();
    group.name = primaryFile.name;
    group.add(obj);
    return {
      root: group,
      clips: [],
      format: 'obj',
      missingResources: Array.from(new Set(missingResources)),
      warnings,
    };
  } finally {
    // Allow textures to settle on next tick before releasing primary object URLs
    setTimeout(() => {
      for (const u of objectUrls) URL.revokeObjectURL(u);
    }, 5000);
  }
}

export async function loadAnimationClipsFromFile(
  file: File
): Promise<THREE.AnimationClip[]> {
  const format = detectModelFormat(file.name);
  if (format !== 'fbx' && format !== 'glb' && format !== 'gltf') {
    throw new Error('Animation clips must be uploaded as .fbx, .glb, or .gltf files.');
  }

  const url = URL.createObjectURL(file);
  try {
    if (format === 'fbx') {
      const loader = new FBXLoader();
      const fbx = await loader.loadAsync(url);
      return (fbx.animations || []).map((c, idx) => {
        if (!c.name || c.name === 'mixamo.com') {
          c.name = file.name.replace(/\.[^.]+$/, '') + (idx > 0 ? `_${idx + 1}` : '');
        }
        return c;
      });
    }
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    return (gltf.animations || []).map((c, idx) => {
      if (!c.name) c.name = file.name.replace(/\.[^.]+$/, '') + (idx > 0 ? `_${idx + 1}` : '');
      return c;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
