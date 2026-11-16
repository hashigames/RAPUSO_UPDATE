import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  BoneRotationMap,
  CameraPreset,
  EnvironmentBackground,
  MaterialAppearanceSettings,
  PropAttachment,
  TimelineMode,
  Vec3Tuple,
} from '../../../shared/studio';
import type {
  FingerControlsState,
  RasterOutputRecord,
  RasterRenderSettings,
  RasterSceneAssets,
} from '../../../shared/pose-raster';
import { applyBoneRotationsFromRest, RestPoseSnapshot } from '../../lib/animation/poseIk';
import { applyStudioMaterialMode, OriginalMaterialCache } from '../../lib/animation/materials';
import {
  compositeRgbaOver,
  computeCameraPresetForSubject,
  computeRgbaOpaqueCenter,
  packFilesToZip,
} from '../../lib/animation/raster';
import {
  applyAnimeToonShaderToRoot,
  downsampleRgbaBilinear,
  renderJapaneseAnimeMangaPasses,
  stylizeBackgroundForAnime,
} from '../../lib/animation/animeShader';
import { createBuiltinPropMesh } from '../../lib/animation/demoRig';

export interface Viewport3DHandle {
  framePreset: (preset: CameraPreset) => void;
  applyRasterCameraPreview: (settings: RasterRenderSettings) => void;
  captureRasterViews: (
    views: CameraPreset[],
    settings: RasterRenderSettings,
    sourcePoseName: string,
    signal?: AbortSignal,
    sceneAssets?: RasterSceneAssets
  ) => Promise<RasterOutputRecord[]>;
  exportFramesZip: (params: {
    durationSec: number;
    fps: number;
    manifestJson: string;
    onProgress: (pct: number) => void;
    signal: AbortSignal;
    onStepTime: (tSec: number) => void;
  }) => Promise<Uint8Array>;
  recordVideo: (params: {
    durationSec: number;
    fps: number;
    onProgress: (pct: number) => void;
    signal: AbortSignal;
    onStepTime: (tSec: number) => void;
  }) => Promise<{ blob: Blob; mimeType: string; extension: 'mp4' | 'webm'; actualFpsNote: string }>;
}

interface Viewport3DProps {
  subjectRoot: THREE.Object3D;
  restPose: RestPoseSnapshot;
  clips: THREE.AnimationClip[];
  activeClipName: string | null;
  timelineMode: TimelineMode;
  currentTimeSec: number;
  isPlaying: boolean;
  boneRotations: BoneRotationMap;
  bonePositions?: BoneRotationMap;
  fingerControls: FingerControlsState;
  selectedBoneName: string | null;
  showGizmoRings: boolean;
  materialSettings: MaterialAppearanceSettings;
  propsList: PropAttachment[];
  environmentBg: EnvironmentBackground | null;
  onSelectBone?: (boneName: string) => void;
  onRotateBoneDelta?: (boneName: string, deltaEuler: Vec3Tuple) => void;
  onFrameRendered?: () => void;
}

function loadHtmlImageAsync(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load raster scene image asset.'));
    img.src = src;
  });
}

function drawImageCoverToRgba(
  img: HTMLImageElement,
  width: number,
  height: number
): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const scale = Math.max(width / Math.max(1, img.width), height / Math.max(1, img.height));
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (width - dw) * 0.5;
  const dy = (height - dh) * 0.5;
  ctx.drawImage(img, dx, dy, dw, dh);
  return ctx.getImageData(0, 0, width, height).data;
}

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return /SwiftShader|llvmpipe|Software Rasterizer/i.test(renderer);
  } catch {
    return true;
  }
}

export const Viewport3D = forwardRef<Viewport3DHandle, Viewport3DProps>(
  (
    {
      subjectRoot,
      restPose,
      clips,
      activeClipName,
      timelineMode,
      currentTimeSec,
      isPlaying,
      boneRotations,
      bonePositions,
      fingerControls,
      selectedBoneName,
      showGizmoRings,
      materialSettings,
      propsList,
      environmentBg,
      onRotateBoneDelta,
      onFrameRendered,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const stateRef = useRef({
      renderer: null as THREE.WebGLRenderer | null,
      scene: null as THREE.Scene | null,
      camera: null as THREE.PerspectiveCamera | null,
      controls: null as OrbitControls | null,
      mixer: null as THREE.AnimationMixer | null,
      grid: null as THREE.GridHelper | null,
      skeletonHelper: null as THREE.SkeletonHelper | null,
      gizmoGroup: null as THREE.Group | null,
      propsGroup: null as THREE.Group | null,
      subjectGroup: null as THREE.Group | null,
      materialCache: new WeakMap<THREE.Mesh, { material: THREE.Material | THREE.Material[] }>(),
      isSoftwareGl: false,
      needsRender: true,
    });

    const callbacksRef = useRef({ onRotateBoneDelta, onFrameRendered });
    callbacksRef.current = { onRotateBoneDelta, onFrameRendered };

    // Initialize WebGLRenderer & Scene once inside containerRef
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const isSoftwareGl = detectSoftwareGl();
      stateRef.current.isSoftwareGl = isSoftwareGl;

      const renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.dataset.testid = 'studio-webgl-canvas';

      container.innerHTML = '';
      container.appendChild(renderer.domElement);
      canvasRef.current = renderer.domElement;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#0d0f18');

      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;

      const keyLight = new THREE.DirectionalLight(0xfff5ee, 1.5);
      keyLight.position.set(2.8, 4.5, 3.2);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xe6a1b0, 0.75);
      rimLight.position.set(-2.5, 2.2, -3.0);
      scene.add(rimLight);
      scene.add(new THREE.HemisphereLight(0xcdd7f5, 0x1a1e2e, 0.65));

      const grid = new THREE.GridHelper(10, 20, 0x3b425c, 0x1e2233);
      scene.add(grid);

      const subjectGroup = new THREE.Group();
      scene.add(subjectGroup);

      const propsGroup = new THREE.Group();
      scene.add(propsGroup);

      // Local-space rotation rings gizmo (3 colored orthogonal torus rings)
      const gizmoGroup = new THREE.Group();
      gizmoGroup.visible = false;
      const ringGeo = new THREE.TorusGeometry(0.16, 0.008, 8, 36);
      const ringX = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf87171, depthTest: false }));
      ringX.rotation.y = Math.PI / 2;
      ringX.name = 'GIZMO_RING_X';
      const ringY = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false }));
      ringY.rotation.x = Math.PI / 2;
      ringY.name = 'GIZMO_RING_Y';
      const ringZ = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x60a5fa, depthTest: false }));
      ringZ.name = 'GIZMO_RING_Z';
      gizmoGroup.renderOrder = 999;
      gizmoGroup.add(ringX, ringY, ringZ);
      scene.add(gizmoGroup);

      const rect = container.getBoundingClientRect();
      const camera = new THREE.PerspectiveCamera(
        38,
        Math.max(1, rect.width) / Math.max(1, rect.height),
        0.05,
        100
      );
      camera.position.set(0.85, 1.35, 3.15);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.92, 0);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.08;
      controls.update();
      controls.addEventListener('change', () => {
        stateRef.current.needsRender = true;
      });

      stateRef.current.renderer = renderer;
      stateRef.current.scene = scene;
      stateRef.current.camera = camera;
      stateRef.current.controls = controls;
      stateRef.current.grid = grid;
      stateRef.current.gizmoGroup = gizmoGroup;
      stateRef.current.propsGroup = propsGroup;
      stateRef.current.subjectGroup = subjectGroup;

      const handleResize = () => {
        if (!container || !stateRef.current.renderer || !stateRef.current.camera) return;
        const w = Math.max(100, container.clientWidth);
        const h = Math.max(100, container.clientHeight);
        stateRef.current.renderer.setSize(w, h, false);
        stateRef.current.camera.aspect = w / h;
        stateRef.current.camera.updateProjectionMatrix();
        stateRef.current.needsRender = true;
      };
      handleResize();

      const ro = new ResizeObserver(handleResize);
      ro.observe(container);

      // Raycasting drag handler for gizmo local rotation rings
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let draggingAxis: 'x' | 'y' | 'z' | null = null;
      let draggingBoneName: string | null = null;
      let lastX = 0;

      const onPointerDown = (ev: PointerEvent) => {
        const g = stateRef.current.gizmoGroup;
        if (!g || !g.visible || !stateRef.current.camera) return;
        const bounds = renderer.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((ev.clientY - bounds.top) / bounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, stateRef.current.camera);
        const hits = raycaster.intersectObjects(g.children, false);
        if (hits.length > 0) {
          const hitName = hits[0].object.name;
          draggingAxis = hitName === 'GIZMO_RING_X' ? 'x' : hitName === 'GIZMO_RING_Y' ? 'y' : 'z';
          draggingBoneName = g.userData.boneName || null;
          lastX = ev.clientX;
          controls.enabled = false;
        }
      };

      const onPointerMove = (ev: PointerEvent) => {
        if (!draggingAxis || !draggingBoneName) return;
        const dx = ev.clientX - lastX;
        lastX = ev.clientX;
        const angleDelta = dx * 0.015;
        if (Math.abs(angleDelta) > 0 && callbacksRef.current.onRotateBoneDelta) {
          callbacksRef.current.onRotateBoneDelta(draggingBoneName, {
            x: draggingAxis === 'x' ? angleDelta : 0,
            y: draggingAxis === 'y' ? angleDelta : 0,
            z: draggingAxis === 'z' ? angleDelta : 0,
          });
        }
      };

      const onPointerUp = () => {
        if (draggingAxis) {
          draggingAxis = null;
          draggingBoneName = null;
          controls.enabled = true;
        }
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);

      let rafId = 0;
      const tick = () => {
        rafId = requestAnimationFrame(tick);
        if (controls.enableDamping) controls.update();
        if (stateRef.current.needsRender) {
          renderer.render(scene, camera);
          stateRef.current.needsRender = false;
          callbacksRef.current.onFrameRendered?.();
        }
      };
      tick();

      return () => {
        cancelAnimationFrame(rafId);
        ro.disconnect();
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        controls.dispose();
        pmrem.dispose();
        envTex.dispose();
        renderer.dispose();
      };
    }, []);

    // Mount current character subjectRoot & build mixer/skeleton helper
    useEffect(() => {
      const { subjectGroup, scene } = stateRef.current;
      if (!subjectGroup || !scene) return;

      subjectGroup.clear();
      subjectGroup.add(subjectRoot);
      stateRef.current.mixer = new THREE.AnimationMixer(subjectRoot);

      if (stateRef.current.skeletonHelper) {
        scene.remove(stateRef.current.skeletonHelper);
        stateRef.current.skeletonHelper.dispose();
        stateRef.current.skeletonHelper = null;
      }

      const helper = new THREE.SkeletonHelper(subjectRoot);
      helper.visible = materialSettings.showSkeleton;
      scene.add(helper);
      stateRef.current.skeletonHelper = helper;

      stateRef.current.needsRender = true;
    }, [subjectRoot]);

    // Sync skeleton visibility & materials
    useEffect(() => {
      if (stateRef.current.skeletonHelper) {
        stateRef.current.skeletonHelper.visible = materialSettings.showSkeleton;
      }
      applyStudioMaterialMode(subjectRoot, stateRef.current.materialCache, materialSettings);
      stateRef.current.needsRender = true;
    }, [subjectRoot, materialSettings]);

    // Sync background environment
    useEffect(() => {
      const scene = stateRef.current.scene;
      if (!scene) return;
      if (!environmentBg || !environmentBg.dataUrlOrPath) {
        scene.background = new THREE.Color('#0d0f18');
        stateRef.current.needsRender = true;
        return;
      }
      new THREE.TextureLoader().load(
        environmentBg.dataUrlOrPath,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          scene.background = tex;
          stateRef.current.needsRender = true;
        },
        undefined,
        () => {
          scene.background = new THREE.Color('#0d0f18');
          stateRef.current.needsRender = true;
        }
      );
    }, [environmentBg]);

    // Apply current pose or timeline clip at currentTimeSec
    useEffect(() => {
      const mixer = stateRef.current.mixer;
      if (timelineMode === 'clips' && mixer && activeClipName) {
        const clip = clips.find((c) => c.name === activeClipName);
        if (clip) {
          mixer.stopAllAction();
          const action = mixer.clipAction(clip);
          action.play();
          mixer.setTime(currentTimeSec % Math.max(clip.duration, 0.01));
        } else {
          applyBoneRotationsFromRest(subjectRoot, restPose, boneRotations, fingerControls, bonePositions);
        }
      } else {
        if (mixer) mixer.stopAllAction();
        applyBoneRotationsFromRest(subjectRoot, restPose, boneRotations, fingerControls, bonePositions);
      }

      // Sync bone-attached gizmo rings
      const g = stateRef.current.gizmoGroup;
      if (g) {
        if (showGizmoRings && selectedBoneName) {
          const targetBone = subjectRoot.getObjectByName(selectedBoneName);
          if (targetBone) {
            const wp = new THREE.Vector3();
            const wq = new THREE.Quaternion();
            targetBone.getWorldPosition(wp);
            targetBone.getWorldQuaternion(wq);
            g.position.copy(wp);
            g.quaternion.copy(wq);
            g.userData.boneName = selectedBoneName;
            g.visible = true;
          } else {
            g.visible = false;
          }
        } else {
          g.visible = false;
        }
      }

      // Sync bone-attached props
      const pg = stateRef.current.propsGroup;
      if (pg) {
        pg.clear();
        for (const prop of propsList) {
          if (!prop.visible) continue;
          const kind = prop.assetId.includes('blade')
            ? 'blade'
            : prop.assetId.includes('mic')
            ? 'mic'
            : 'block';
          const mesh = createBuiltinPropMesh(kind);
          mesh.position.set(prop.transform.position.x, prop.transform.position.y, prop.transform.position.z);
          mesh.rotation.set(prop.transform.rotation.x, prop.transform.rotation.y, prop.transform.rotation.z);
          mesh.scale.set(prop.transform.scale.x, prop.transform.scale.y, prop.transform.scale.z);
          if (prop.attachedBoneName) {
            const b = subjectRoot.getObjectByName(prop.attachedBoneName);
            if (b) {
              const wp = new THREE.Vector3();
              const wq = new THREE.Quaternion();
              b.getWorldPosition(wp);
              b.getWorldQuaternion(wq);
              const holder = new THREE.Group();
              holder.position.copy(wp);
              holder.quaternion.copy(wq);
              holder.add(mesh);
              pg.add(holder);
              continue;
            }
          }
          pg.add(mesh);
        }
      }

      stateRef.current.needsRender = true;
    }, [
      subjectRoot,
      restPose,
      clips,
      activeClipName,
      timelineMode,
      currentTimeSec,
      boneRotations,
      bonePositions,
      fingerControls,
      selectedBoneName,
      showGizmoRings,
      propsList,
      isPlaying,
    ]);

    useImperativeHandle(ref, () => ({
      framePreset(preset: CameraPreset) {
        const { camera, controls } = stateRef.current;
        if (!camera || !controls) return;
        const { position, target, up } = computeCameraPresetForSubject(subjectRoot, preset);
        camera.up.copy(up);
        camera.position.copy(position);
        controls.target.copy(target);
        controls.update();
        stateRef.current.needsRender = true;
      },

      applyRasterCameraPreview(settings: RasterRenderSettings) {
        const { camera, controls } = stateRef.current;
        if (!camera || !controls) return;
        if (settings.cameraFraming === 'viewport_exact') {
          camera.fov = settings.cameraFov;
          camera.updateProjectionMatrix();
          stateRef.current.needsRender = true;
          return;
        }
        const { position, target, up, fov } = computeCameraPresetForSubject(
          subjectRoot,
          'perspective',
          settings
        );
        camera.fov = fov;
        camera.up.copy(up);
        camera.position.copy(position);
        camera.updateProjectionMatrix();
        controls.target.copy(target);
        controls.update();
        stateRef.current.needsRender = true;
      },

      async captureRasterViews(views, settings, sourcePoseName, signal, sceneAssets) {
        const { renderer, scene, camera, controls, grid, skeletonHelper, gizmoGroup } =
          stateRef.current;
        if (!renderer || !scene || !camera || !controls) {
          throw new Error('Viewport renderer is not initialized.');
        }

        // Save exact user state to restore unconditionally in finally
        const savedCamPos = camera.position.clone();
        const savedCamUp = camera.up.clone();
        const savedTarget = controls.target.clone();
        const savedAspect = camera.aspect;
        const savedFov = camera.fov;
        const savedBg = scene.background;
        const savedGridVisible = grid ? grid.visible : true;
        const savedSkelVisible = skeletonHelper ? skeletonHelper.visible : false;
        const savedGizmoVisible = gizmoGroup ? gizmoGroup.visible : false;
        const savedSize = new THREE.Vector2();
        renderer.getSize(savedSize);
        const savedPixelRatio = renderer.getPixelRatio();
        const savedToneMapping = renderer.toneMapping;
        const savedToneExposure = renderer.toneMappingExposure;

        const outputs: RasterOutputRecord[] = [];
        const offCanvas = document.createElement('canvas');
        offCanvas.width = settings.resolutionWidth;
        offCanvas.height = settings.resolutionHeight;
        const offCtx = offCanvas.getContext('2d')!;

        // Load optional scene assets (Background images, Prop images, Reference images)
        const loadedBgs = await Promise.all(
          (sceneAssets?.backgroundImages ?? []).map((a) => loadHtmlImageAsync(a.dataUrl).catch(() => null))
        ).then((arr) => arr.filter((x): x is HTMLImageElement => Boolean(x)));
        const loadedProps = await Promise.all(
          (sceneAssets?.propImages ?? []).map((a) => loadHtmlImageAsync(a.dataUrl).catch(() => null))
        ).then((arr) => arr.filter((x): x is HTMLImageElement => Boolean(x)));
        const loadedRefs = await Promise.all(
          (sceneAssets?.referenceImages ?? []).map((a) => loadHtmlImageAsync(a.dataUrl).catch(() => null))
        ).then((arr) => arr.filter((x): x is HTMLImageElement => Boolean(x)));

        // Mount uploaded Prop images onto 3D planes inside the scene so the rasterizer applies cleanly in all 4 views
        const tempPropPlanesGroup = new THREE.Group();
        const tempDisposables: Array<{ dispose: () => void }> = [];
        if (loadedProps.length > 0) {
          const box = new THREE.Box3().setFromObject(subjectRoot);
          const center = new THREE.Vector3(0, 0.9, 0);
          const size = new THREE.Vector3(1, 1.7, 1);
          if (!box.isEmpty()) {
            box.getCenter(center);
            box.getSize(size);
          }
          const baseH = Math.max(0.75, size.y * 0.58) * (settings.propScale || 1);
          loadedProps.forEach((img, idx) => {
            const aspect = img.width / Math.max(1, img.height);
            const planeW = baseH * aspect;
            const tex = new THREE.Texture(img);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            const geo = new THREE.PlaneGeometry(planeW, baseH);
            const mat = new THREE.MeshBasicMaterial({
              map: tex,
              transparent: true,
              alphaTest: 0.12,
              side: THREE.DoubleSide,
            });
            tempDisposables.push(tex, geo, mat);
            const plane = new THREE.Mesh(geo, mat);
            const spread =
              loadedProps.length === 1
                ? 0
                : (idx - (loadedProps.length - 1) * 0.5) * (planeW * 0.85);
            plane.position.set(
              center.x + (settings.propOffsetX ?? 0.65) + spread,
              center.y + (settings.propOffsetY ?? 0),
              center.z + (idx % 2 === 0 ? 0.08 : -0.08)
            );
            tempPropPlanesGroup.add(plane);
          });
          scene.add(tempPropPlanesGroup);
        }

        let toonSession: { dispose: () => void } | null = null;
        let rimLight: THREE.DirectionalLight | null = null;
        let faceFillLight: THREE.DirectionalLight | null = null;

        try {
          if (grid) grid.visible = false;
          if (skeletonHelper) skeletonHelper.visible = false;
          if (gizmoGroup) gizmoGroup.visible = false;

          if (settings.use3DToonShader) {
            const toonCache: OriginalMaterialCache = new WeakMap();
            toonSession = applyAnimeToonShaderToRoot(subjectRoot, toonCache, settings);
            renderer.toneMapping = THREE.NoToneMapping;
          }
          if (settings.preserveFaceDetails) {
            // Soft frontal fill avoids muddy under-bang shadows obscuring eye colors & mouth
            faceFillLight = new THREE.DirectionalLight(0xfffaf6, 0.36);
            faceFillLight.position.set(0.3, 1.8, 3.4);
            scene.add(faceFillLight);
          }
          if (settings.rimGlow > 0.05) {
            rimLight = new THREE.DirectionalLight(
              settings.shadowTint === 'warm_sepia' ? 0xffe4d0 : 0xdbe8ff,
              1.15 * settings.rimGlow
            );
            rimLight.position.set(-1.8, 2.2, -2.5);
            scene.add(rimLight);
          }

          scene.background = null; // alpha clean character + props capture
          renderer.setClearColor(0x000000, 0);

          const W = settings.resolutionWidth;
          const H = settings.resolutionHeight;
          const ssFactor = settings.supersample2x ? 2 : 1;
          const renderW = Math.min(3072, W * ssFactor);
          const renderH = Math.min(3072, H * ssFactor);

          renderer.setPixelRatio(1);
          renderer.setSize(renderW, renderH, false);
          camera.aspect = W / H;
          camera.updateProjectionMatrix();

          const gl = renderer.getContext();
          const pixelBuf = new Uint8Array(renderW * renderH * 4);

          for (let viewIdx = 0; viewIdx < views.length; viewIdx++) {
            const view = views[viewIdx];
            if (signal?.aborted) throw new DOMException('Raster capture cancelled', 'AbortError');

            if (view === 'perspective' && settings.cameraFraming === 'viewport_exact') {
              camera.fov = settings.cameraFov || savedFov;
              camera.up.copy(savedCamUp);
              camera.position.copy(savedCamPos);
              camera.lookAt(savedTarget);
            } else {
              const framed = computeCameraPresetForSubject(subjectRoot, view, settings);
              camera.fov = framed.fov;
              camera.up.copy(framed.up);
              camera.position.copy(framed.position);
              camera.lookAt(framed.target);
            }
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld(true);

            // Billboard uploaded prop images cleanly toward the active view camera
            for (const propPlane of tempPropPlanesGroup.children) {
              propPlane.quaternion.copy(camera.quaternion);
            }

            renderer.render(scene, camera);
            gl.readPixels(0, 0, renderW, renderH, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf);

            // Flip Y from WebGL bottom-up origin to canvas top-down
            const flippedHi = new Uint8ClampedArray(pixelBuf.length);
            const rowBytes = renderW * 4;
            for (let y = 0; y < renderH; y++) {
              const srcRow = (renderH - 1 - y) * rowBytes;
              const dstRow = y * rowBytes;
              flippedHi.set(pixelBuf.subarray(srcRow, srcRow + rowBytes), dstRow);
            }

            const flipped = downsampleRgbaBilinear(flippedHi, renderW, renderH, W, H);

            // Rasterize foreground (Character + Props) with transparent background via Japanese Anime/Manga shader pipeline
            const fgPasses = renderJapaneseAnimeMangaPasses(W, H, flipped, {
              ...settings,
              transparentBackground: true,
            });

            let finalCombined = fgPasses.combined;
            let finalColorPass = fgPasses.colorPass;
            let bgOnlyRgba: Uint8ClampedArray | null = null;

            if (!settings.transparentBackground) {
              if (loadedBgs.length > 0) {
                const bgImg = loadedBgs[viewIdx % loadedBgs.length];
                const bgRaw = drawImageCoverToRgba(bgImg, W, H);
                const bgStyled = stylizeBackgroundForAnime(W, H, bgRaw, settings);
                bgOnlyRgba = bgStyled.combined;
                finalCombined = compositeRgbaOver(fgPasses.combined, bgStyled.combined);
                finalColorPass = compositeRgbaOver(fgPasses.colorPass, bgStyled.colorPass);
              } else {
                const paperPass = renderJapaneseAnimeMangaPasses(W, H, flipped, settings);
                finalCombined = paperPass.combined;
                // Generate solid paper RGBA buffer so moving the character keeps paper fixed
                const cleanHex = settings.backgroundHex.replace('#', '');
                const hexNum = parseInt(cleanHex.length === 6 ? cleanHex : 'f7f6f2', 16);
                const pr = (hexNum >> 16) & 255;
                const pg = (hexNum >> 8) & 255;
                const pb = hexNum & 255;
                bgOnlyRgba = new Uint8ClampedArray(W * H * 4);
                for (let p = 0; p < bgOnlyRgba.length; p += 4) {
                  bgOnlyRgba[p] = pr;
                  bgOnlyRgba[p + 1] = pg;
                  bgOnlyRgba[p + 2] = pb;
                  bgOnlyRgba[p + 3] = 255;
                }
              }
            }

            const toPng = (buf: Uint8ClampedArray, drawRefsOverlay = false) => {
              const imgData = new ImageData(new Uint8ClampedArray(buf), W, H);
              offCtx.clearRect(0, 0, W, H);
              offCtx.putImageData(imgData, 0, 0);

              if (drawRefsOverlay && settings.includeReferenceOverlay && loadedRefs.length > 0) {
                const thumbW = Math.round(W * 0.2);
                const pad = Math.round(W * 0.02);
                loadedRefs.slice(0, 3).forEach((rImg, rIdx) => {
                  const aspect = rImg.height / Math.max(1, rImg.width);
                  const thumbH = Math.min(Math.round(H * 0.26), Math.round(thumbW * aspect));
                  const rx = W - pad - thumbW;
                  const ry = H - pad - thumbH - rIdx * (thumbH + Math.round(pad * 0.5));
                  if (ry < pad) return;
                  offCtx.fillStyle = '#0d0f18';
                  offCtx.fillRect(rx - 4, ry - 4, thumbW + 8, thumbH + 8);
                  offCtx.drawImage(rImg, rx, ry, thumbW, thumbH);
                  offCtx.strokeStyle = '#12141e';
                  offCtx.lineWidth = 3;
                  offCtx.strokeRect(rx - 4, ry - 4, thumbW + 8, thumbH + 8);
                });
              }

              return offCanvas.toDataURL('image/png');
            };

            const fgCenter = computeRgbaOpaqueCenter(fgPasses.combined, W, H);
            const foregroundDataUrl = toPng(fgPasses.combined, false);
            const backgroundDataUrl = bgOnlyRgba ? toPng(bgOnlyRgba, true) : undefined;

            outputs.push({
              id: `raster-${view}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              createdAt: new Date().toISOString(),
              view,
              sourcePoseName,
              width: W,
              height: H,
              combinedDataUrl: toPng(finalCombined, true),
              foregroundDataUrl,
              backgroundDataUrl,
              foregroundOffsetX: 0,
              foregroundOffsetY: 0,
              foregroundScale: 1,
              foregroundContentCenter: fgCenter,
              linePassDataUrl: toPng(fgPasses.linePass),
              colorPassDataUrl: toPng(finalColorPass),
              shadowPassDataUrl: toPng(fgPasses.shadowPass),
            });

            await new Promise((r) => setTimeout(r, 12));
          }
          return outputs;
        } finally {
          if (toonSession) toonSession.dispose();
          if (rimLight) scene.remove(rimLight);
          if (faceFillLight) scene.remove(faceFillLight);
          scene.remove(tempPropPlanesGroup);
          for (const d of tempDisposables) d.dispose();
          renderer.toneMapping = savedToneMapping;
          renderer.toneMappingExposure = savedToneExposure;
          renderer.setPixelRatio(savedPixelRatio);
          renderer.setSize(savedSize.x, savedSize.y, false);
          camera.aspect = savedAspect;
          camera.fov = savedFov;
          camera.up.copy(savedCamUp);
          camera.position.copy(savedCamPos);
          controls.target.copy(savedTarget);
          camera.updateProjectionMatrix();
          controls.update();
          scene.background = savedBg;
          if (grid) grid.visible = savedGridVisible;
          if (skeletonHelper) skeletonHelper.visible = savedSkelVisible;
          if (gizmoGroup) gizmoGroup.visible = savedGizmoVisible;
          renderer.render(scene, camera);
        }
      },

      async exportFramesZip({ durationSec, fps, manifestJson, onProgress, signal, onStepTime }) {
        const { renderer, scene, camera } = stateRef.current;
        if (!renderer || !scene || !camera) throw new Error('Renderer unavailable');
        const totalFrames = Math.max(1, Math.min(300, Math.round(durationSec * fps)));
        const files: Record<string, Uint8Array | string> = {
          'manifest.json': manifestJson,
        };

        for (let i = 0; i < totalFrames; i++) {
          if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          const t = (i / Math.max(1, totalFrames - 1)) * durationSec;
          onStepTime(t);
          await new Promise((r) => requestAnimationFrame(r));
          renderer.render(scene, camera);
          const dataUrl = renderer.domElement.toDataURL('image/png');
          const b64 = dataUrl.split(',')[1] || '';
          const bin = atob(b64);
          const u8 = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
          files[`frames/frame_${String(i + 1).padStart(4, '0')}.png`] = u8;
          onProgress(Math.round(((i + 1) / totalFrames) * 100));
        }

        return packFilesToZip(files);
      },

      async recordVideo({ durationSec, fps, onProgress, signal, onStepTime }) {
        const { renderer, scene, camera } = stateRef.current;
        if (!renderer || !scene || !camera) throw new Error('Renderer unavailable');

        const canvas = renderer.domElement;
        if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
          throw new Error('Browser MediaRecorder or canvas.captureStream is unavailable.');
        }

        const mp4Candidate = 'video/mp4;codecs=avc1';
        const webmVp9 = 'video/webm;codecs=vp9';
        const webmPlain = 'video/webm';
        const chosenMime = MediaRecorder.isTypeSupported(mp4Candidate)
          ? mp4Candidate
          : MediaRecorder.isTypeSupported(webmVp9)
          ? webmVp9
          : webmPlain;
        const extension: 'mp4' | 'webm' = chosenMime.startsWith('video/mp4') ? 'mp4' : 'webm';

        const stream = canvas.captureStream(fps);
        const recorder = new MediaRecorder(stream, {
          mimeType: chosenMime,
          videoBitsPerSecond: 4_000_000,
        });
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };

        const stoppedPromise = new Promise<Blob>((resolve, reject) => {
          recorder.onstop = () => resolve(new Blob(chunks, { type: chosenMime }));
          recorder.onerror = () => reject(new Error('MediaRecorder encoding failed.'));
        });

        recorder.start(200);
        const startPerf = performance.now();
        const totalMs = durationSec * 1000;

        while (true) {
          if (signal.aborted) {
            recorder.stop();
            throw new DOMException('Recording cancelled', 'AbortError');
          }
          const elapsedMs = performance.now() - startPerf;
          if (elapsedMs >= totalMs) break;
          onStepTime(elapsedMs / 1000);
          renderer.render(scene, camera);
          onProgress(Math.min(99, Math.round((elapsedMs / totalMs) * 100)));
          await new Promise((r) => setTimeout(r, Math.max(16, Math.round(1000 / fps))));
        }

        recorder.stop();
        const blob = await stoppedPromise;
        onProgress(100);
        return {
          blob,
          mimeType: chosenMime,
          extension,
          actualFpsNote: `${fps} fps target (${stateRef.current.isSoftwareGl ? 'Software WebGL may drop frames' : 'Hardware WebGL'})`,
        };
      },
    }));

    return (
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden bg-[var(--surface-0)]"
        data-testid="viewport-container"
      />
    );
  }
);
Viewport3D.displayName = 'Viewport3D';
