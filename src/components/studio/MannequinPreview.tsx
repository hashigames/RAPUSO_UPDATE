import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import type { BoneRotationMap } from '../../../shared/studio';
import type { FingerControlsState, MannequinDriverState } from '../../../shared/pose-raster';
import { createDemoSkinnedCharacter } from '../../lib/animation/demoRig';
import { applyBoneRotationsFromRest, captureRestPose } from '../../lib/animation/poseIk';
import type { StudioStrings } from '../../lib/i18n';

const MANNEQUIN_EDITABLE_BONES = [
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftUpperArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightUpperArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
] as const;

interface MannequinPreviewProps {
  driverState: MannequinDriverState;
  strings: StudioStrings;
  onUpdateDriverRotations: (rotations: BoneRotationMap) => void;
  onUpdateDriverPositions?: (positions: BoneRotationMap) => void;
  onUpdateDriverFingers: (fingers: FingerControlsState) => void;
  onCopyPoseToTarget: () => void;
  onToggleLiveFollow: (enabled: boolean) => void;
  onApplyMultiViewToMannequin: () => Promise<void> | void;
  multiViewReadyCount?: number;
  multiViewBusy?: boolean;
  multiViewNote?: string | null;
  stageMinimized?: boolean;
  onToggleStageMinimized?: () => void;
}

export const MannequinPreview: React.FC<MannequinPreviewProps> = ({
  driverState,
  strings,
  onUpdateDriverRotations,
  onUpdateDriverPositions,
  onCopyPoseToTarget,
  onToggleLiveFollow,
  onApplyMultiViewToMannequin,
  multiViewReadyCount = 0,
  multiViewBusy = false,
  multiViewNote = null,
  stageMinimized = false,
  onToggleStageMinimized,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [expanded3D, setExpanded3D] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [selectedBone, setSelectedBone] = useState<string>('LeftUpperArm');
  const [gizmoMode, setGizmoMode] = useState<'rotate' | 'move'>('rotate');

  const rigRef = useRef<{
    root: THREE.Group;
    restPose: ReturnType<typeof captureRestPose>;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    skeletonHelper: THREE.SkeletonHelper;
    gizmoGroup: THREE.Group;
    moveGizmoGroup: THREE.Group;
    jointMarkers: Map<string, THREE.Mesh>;
    needsRender: boolean;
  } | null>(null);

  const liveRefs = useRef({
    driverBoneRotations: driverState.driverBoneRotations,
    driverBonePositions: driverState.driverBonePositions || {},
    selectedBone,
    showSkeleton,
    gizmoMode,
    onUpdateDriverRotations,
    onUpdateDriverPositions,
  });
  liveRefs.current = {
    driverBoneRotations: driverState.driverBoneRotations,
    driverBonePositions: driverState.driverBonePositions || {},
    selectedBone,
    showSkeleton,
    gizmoMode,
    onUpdateDriverRotations,
    onUpdateDriverPositions,
  };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const initialW = Math.max(220, el.clientWidth || 320);
    const initialH = Math.max(220, el.clientHeight || 300);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(initialW, initialH, false);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    el.innerHTML = '';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0d14');
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dir = new THREE.DirectionalLight(0xfef2f4, 1.35);
    dir.position.set(1.5, 2.8, 2.2);
    scene.add(dir);

    const bundle = createDemoSkinnedCharacter('mannequin');
    const restPose = captureRestPose(bundle.root);
    scene.add(bundle.root);
    scene.add(new THREE.GridHelper(3.2, 10, 0x3b425c, 0x1c2030));

    const skeletonHelper = new THREE.SkeletonHelper(bundle.root);
    skeletonHelper.visible = liveRefs.current.showSkeleton;
    scene.add(skeletonHelper);

    // Clickable bone joint markers so customers can pick mannequin bones directly in 3D
    const markersGroup = new THREE.Group();
    markersGroup.renderOrder = 998;
    const markerGeo = new THREE.SphereGeometry(0.028, 12, 10);
    const jointMarkers = new Map<string, THREE.Mesh>();
    for (const boneName of MANNEQUIN_EDITABLE_BONES) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe6a1b0,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });
      const marker = new THREE.Mesh(markerGeo, mat);
      marker.name = `JOINT_${boneName}`;
      marker.userData.boneName = boneName;
      marker.renderOrder = 998;
      markersGroup.add(marker);
      jointMarkers.set(boneName, marker);
    }
    scene.add(markersGroup);

    // Interactive local XYZ rotation gizmo rings for the selected mannequin bone
    const gizmoGroup = new THREE.Group();
    const ringGeo = new THREE.TorusGeometry(0.15, 0.0085, 8, 32);
    const ringX = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xf87171, depthTest: false })
    );
    ringX.rotation.y = Math.PI / 2;
    ringX.name = 'MANNEQUIN_GIZMO_X';
    const ringY = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false })
    );
    ringY.rotation.x = Math.PI / 2;
    ringY.name = 'MANNEQUIN_GIZMO_Y';
    const ringZ = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0x60a5fa, depthTest: false })
    );
    ringZ.name = 'MANNEQUIN_GIZMO_Z';
    gizmoGroup.renderOrder = 999;
    gizmoGroup.add(ringX, ringY, ringZ);
    scene.add(gizmoGroup);

    // Interactive local XYZ translation arrow gizmo for moving bone nodes
    const moveGizmoGroup = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.16, 8);
    const tipGeo = new THREE.ConeGeometry(0.018, 0.045, 10);
    const buildMoveAxis = (axis: 'X' | 'Y' | 'Z', color: number) => {
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const shaft = new THREE.Mesh(shaftGeo, mat);
      const tip = new THREE.Mesh(tipGeo, mat);
      shaft.position.y = 0.09;
      tip.position.y = 0.19;
      const axisGroup = new THREE.Group();
      axisGroup.add(shaft, tip);
      if (axis === 'X') axisGroup.rotation.z = -Math.PI / 2;
      if (axis === 'Z') axisGroup.rotation.x = Math.PI / 2;
      shaft.name = `MANNEQUIN_MOVE_${axis}`;
      tip.name = `MANNEQUIN_MOVE_${axis}`;
      return axisGroup;
    };
    moveGizmoGroup.renderOrder = 999;
    moveGizmoGroup.visible = false;
    moveGizmoGroup.add(
      buildMoveAxis('X', 0xf87171),
      buildMoveAxis('Y', 0x4ade80),
      buildMoveAxis('Z', 0x60a5fa)
    );
    scene.add(moveGizmoGroup);

    const camera = new THREE.PerspectiveCamera(36, initialW / initialH, 0.05, 40);
    camera.position.set(0.65, 1.18, 3.15);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enableDamping = false;
    controls.update();

    rigRef.current = {
      root: bundle.root,
      restPose,
      renderer,
      scene,
      camera,
      controls,
      skeletonHelper,
      gizmoGroup,
      moveGizmoGroup,
      jointMarkers,
      needsRender: true,
    };

    controls.addEventListener('change', () => {
      if (rigRef.current) rigRef.current.needsRender = true;
    });

    const syncMarkersAndGizmo = () => {
      const rig = rigRef.current;
      if (!rig) return;
      rig.root.updateMatrixWorld(true);
      rig.skeletonHelper.visible = liveRefs.current.showSkeleton;
      markersGroup.visible = liveRefs.current.showSkeleton;

      const wp = new THREE.Vector3();
      const wq = new THREE.Quaternion();

      for (const [bName, marker] of rig.jointMarkers.entries()) {
        const bone = rig.root.getObjectByName(bName);
        if (!bone) {
          marker.visible = false;
          continue;
        }
        bone.getWorldPosition(wp);
        marker.position.copy(wp);
        const isSelected = bName === liveRefs.current.selectedBone;
        marker.scale.setScalar(isSelected ? 1.45 : 1.0);
        (marker.material as THREE.MeshBasicMaterial).color.setHex(
          isSelected ? 0x5eead4 : 0xe6a1b0
        );
        marker.visible = liveRefs.current.showSkeleton;
      }

      const selObj = rig.root.getObjectByName(liveRefs.current.selectedBone);
      if (selObj && liveRefs.current.showSkeleton) {
        selObj.getWorldPosition(wp);
        selObj.getWorldQuaternion(wq);
        rig.gizmoGroup.position.copy(wp);
        rig.gizmoGroup.quaternion.copy(wq);
        rig.moveGizmoGroup.position.copy(wp);
        if (selObj.parent) {
          selObj.parent.getWorldQuaternion(wq);
          rig.moveGizmoGroup.quaternion.copy(wq);
        } else {
          rig.moveGizmoGroup.quaternion.identity();
        }
        rig.gizmoGroup.visible = liveRefs.current.gizmoMode === 'rotate';
        rig.moveGizmoGroup.visible = liveRefs.current.gizmoMode === 'move';
      } else {
        rig.gizmoGroup.visible = false;
        rig.moveGizmoGroup.visible = false;
      }
    };

    const updateSize = () => {
      const rig = rigRef.current;
      if (!rig || !hostRef.current) return;
      const w = Math.max(180, hostRef.current.clientWidth);
      const h = Math.max(180, hostRef.current.clientHeight);
      rig.renderer.setSize(w, h, false);
      rig.camera.aspect = w / h;
      rig.camera.updateProjectionMatrix();
      rig.needsRender = true;
    };
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);

    // Direct 3D raycasting for clicking/dragging joint markers, rotation rings, and move arrows
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let draggingKind: 'rotate' | 'move_axis' | 'move_free' | null = null;
    let draggingAxis: 'x' | 'y' | 'z' | null = null;
    let draggingBone: string | null = null;
    let lastX = 0;
    let lastY = 0;

    const getHitNdc = (ev: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      pointer.y = -((ev.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (!liveRefs.current.showSkeleton) return;
      getHitNdc(ev);

      // 1. Active gizmo drag takes priority
      if (liveRefs.current.gizmoMode === 'rotate' && gizmoGroup.visible) {
        const ringHits = raycaster.intersectObjects(gizmoGroup.children, false);
        if (ringHits.length > 0) {
          const hitName = ringHits[0].object.name;
          draggingKind = 'rotate';
          draggingAxis =
            hitName === 'MANNEQUIN_GIZMO_X' ? 'x' : hitName === 'MANNEQUIN_GIZMO_Y' ? 'y' : 'z';
          draggingBone = liveRefs.current.selectedBone;
          lastX = ev.clientX;
          lastY = ev.clientY;
          controls.enabled = false;
          ev.stopPropagation();
          return;
        }
      } else if (liveRefs.current.gizmoMode === 'move' && moveGizmoGroup.visible) {
        const moveHits = raycaster.intersectObjects(moveGizmoGroup.children, true);
        if (moveHits.length > 0) {
          const hitName = moveHits[0].object.name;
          draggingKind = 'move_axis';
          draggingAxis =
            hitName === 'MANNEQUIN_MOVE_X' ? 'x' : hitName === 'MANNEQUIN_MOVE_Y' ? 'y' : 'z';
          draggingBone = liveRefs.current.selectedBone;
          lastX = ev.clientX;
          lastY = ev.clientY;
          controls.enabled = false;
          ev.stopPropagation();
          return;
        }
      }

      // 2. Otherwise check joint marker click (select bone; in Move mode, also allow immediate node drag)
      const markerHits = raycaster.intersectObjects(markersGroup.children, false);
      if (markerHits.length > 0) {
        const bName = markerHits[0].object.userData.boneName as string | undefined;
        if (bName) {
          setSelectedBone(bName);
          if (rigRef.current) rigRef.current.needsRender = true;
          if (liveRefs.current.gizmoMode === 'move') {
            draggingKind = 'move_free';
            draggingAxis = null;
            draggingBone = bName;
            lastX = ev.clientX;
            lastY = ev.clientY;
            controls.enabled = false;
            ev.stopPropagation();
          }
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!draggingKind || !draggingBone) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;

      if (draggingKind === 'rotate' && draggingAxis) {
        const delta = dx * 0.015;
        if (Math.abs(delta) > 0) {
          const currentMap = liveRefs.current.driverBoneRotations;
          const prev = currentMap[draggingBone] || { x: 0, y: 0, z: 0 };
          liveRefs.current.onUpdateDriverRotations({
            ...currentMap,
            [draggingBone]: {
              x: THREE.MathUtils.clamp(prev.x + (draggingAxis === 'x' ? delta : 0), -3.14, 3.14),
              y: THREE.MathUtils.clamp(prev.y + (draggingAxis === 'y' ? delta : 0), -3.14, 3.14),
              z: THREE.MathUtils.clamp(prev.z + (draggingAxis === 'z' ? delta : 0), -3.14, 3.14),
            },
          });
        }
      } else if (draggingKind === 'move_axis' && draggingAxis && liveRefs.current.onUpdateDriverPositions) {
        const delta = (draggingAxis === 'y' ? -dy : dx) * 0.004;
        if (Math.abs(delta) > 0) {
          const currentPos = liveRefs.current.driverBonePositions;
          const prev = currentPos[draggingBone] || { x: 0, y: 0, z: 0 };
          liveRefs.current.onUpdateDriverPositions({
            ...currentPos,
            [draggingBone]: {
              x: THREE.MathUtils.clamp(prev.x + (draggingAxis === 'x' ? delta : 0), -1.2, 1.2),
              y: THREE.MathUtils.clamp(prev.y + (draggingAxis === 'y' ? delta : 0), -1.2, 1.2),
              z: THREE.MathUtils.clamp(prev.z + (draggingAxis === 'z' ? delta : 0), -1.2, 1.2),
            },
          });
        }
      } else if (draggingKind === 'move_free' && liveRefs.current.onUpdateDriverPositions) {
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const worldDelta = camRight
          .multiplyScalar(dx * 0.004)
          .add(camUp.multiplyScalar(-dy * 0.004));
        const boneObj = rigRef.current?.root.getObjectByName(draggingBone);
        if (boneObj?.parent) {
          const pq = boneObj.parent.getWorldQuaternion(new THREE.Quaternion());
          worldDelta.applyQuaternion(pq.invert());
        }
        const currentPos = liveRefs.current.driverBonePositions;
        const prev = currentPos[draggingBone] || { x: 0, y: 0, z: 0 };
        liveRefs.current.onUpdateDriverPositions({
          ...currentPos,
          [draggingBone]: {
            x: THREE.MathUtils.clamp(prev.x + worldDelta.x, -1.2, 1.2),
            y: THREE.MathUtils.clamp(prev.y + worldDelta.y, -1.2, 1.2),
            z: THREE.MathUtils.clamp(prev.z + worldDelta.z, -1.2, 1.2),
          },
        });
      }
    };

    const onPointerUp = () => {
      if (draggingKind) {
        draggingKind = null;
        draggingAxis = null;
        draggingBone = null;
        controls.enabled = true;
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    let raf = 0;
    const renderLoop = () => {
      raf = requestAnimationFrame(renderLoop);
      const rig = rigRef.current;
      if (rig && rig.needsRender) {
        syncMarkersAndGizmo();
        rig.renderer.render(rig.scene, rig.camera);
        rig.needsRender = false;
      }
    };
    renderLoop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      skeletonHelper.dispose();
      markerGeo.dispose();
      ringGeo.dispose();
      shaftGeo.dispose();
      tipGeo.dispose();
      renderer.dispose();
      rigRef.current = null;
    };
  }, []);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    applyBoneRotationsFromRest(
      rig.root,
      rig.restPose,
      driverState.driverBoneRotations,
      driverState.driverFingerControls,
      driverState.driverBonePositions
    );
    rig.needsRender = true;
  }, [driverState, selectedBone, showSkeleton, expanded3D, gizmoMode]);

  const setPreset = (preset: 'tpose' | 'wave' | 'guard') => {
    if (preset === 'tpose') {
      onUpdateDriverRotations({});
      onUpdateDriverPositions?.({});
    } else if (preset === 'wave') {
      onUpdateDriverRotations({
        Spine: { x: 0, y: 0.15, z: 0 },
        RightUpperArm: { x: -0.25, y: 0, z: -0.4 },
        RightForeArm: { x: 0, y: 1.05, z: 0 },
        LeftUpperArm: { x: 0, y: 0, z: -1.1 },
      });
    } else {
      onUpdateDriverRotations({
        Spine: { x: 0.12, y: -0.2, z: 0 },
        LeftUpperArm: { x: -0.35, y: 0, z: -0.75 },
        LeftForeArm: { x: 0, y: -1.15, z: 0 },
        RightUpperArm: { x: -0.2, y: 0, z: 0.85 },
        RightForeArm: { x: 0, y: 0.85, z: 0 },
        LeftUpLeg: { x: -0.32, y: 0, z: 0.12 },
        LeftLeg: { x: 0.55, y: 0, z: 0 },
      });
    }
  };

  const activeRot = driverState.driverBoneRotations[selectedBone] || { x: 0, y: 0, z: 0 };
  const activePos = driverState.driverBonePositions?.[selectedBone] || { x: 0, y: 0, z: 0 };

  return (
    <div className="rounded border border-white/10 bg-[var(--surface-0)] p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-[11px] font-semibold text-[var(--text-primary)]">
          {strings.mannequinDriverTitle}
        </span>
        <div className="flex items-center gap-1.5">
          <label className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={showSkeleton}
              onChange={(e) => setShowSkeleton(e.target.checked)}
              data-testid="mannequin-skeleton-toggle"
              className="accent-[var(--accent-mint)]"
            />
            <span>Skeleton</span>
          </label>
          {onToggleStageMinimized && (
            <button
              type="button"
              onClick={onToggleStageMinimized}
              data-testid="mannequin-stage-min-btn"
              title={
                stageMinimized
                  ? 'Restore Pose Keyframes 3D World'
                  : 'Minimize Pose Keyframes 3D World for more Mannequin space'
              }
              className="rounded border border-white/15 bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent-mint)]/50 hover:text-white"
            >
              {stageMinimized ? 'Restore Stage' : 'Min Stage'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded3D((v) => !v)}
            data-testid="mannequin-expand-btn"
            title={expanded3D ? 'Compact Mannequin 3D Space' : 'Maximize Mannequin 3D Space'}
            className="inline-flex items-center gap-1 rounded border border-white/15 bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--accent-mint)] hover:border-[var(--accent-mint)]/60"
          >
            {expanded3D ? (
              <>
                <Minimize2 className="h-3 w-3" /> Compact
              </>
            ) : (
              <>
                <Maximize2 className="h-3 w-3" /> Bigger 3D
              </>
            )}
          </button>
        </div>
      </div>

      <div
        ref={hostRef}
        style={{ height: expanded3D || stageMinimized ? '480px' : '300px' }}
        className="relative w-full overflow-hidden rounded border border-white/10 transition-[height] duration-150"
        data-testid="mannequin-preview-canvas"
      />

      <div className="grid grid-cols-4 gap-1">
        <button
          type="button"
          onClick={() => setPreset('tpose')}
          className="rounded border border-white/10 bg-[var(--surface-2)] py-1 text-[11px] text-[var(--text-secondary)] hover:text-white"
        >
          Rest T
        </button>
        <button
          type="button"
          onClick={() => setPreset('wave')}
          className="rounded border border-white/10 bg-[var(--surface-2)] py-1 text-[11px] text-[var(--text-secondary)] hover:text-white"
        >
          Wave
        </button>
        <button
          type="button"
          onClick={() => setPreset('guard')}
          className="rounded border border-white/10 bg-[var(--surface-2)] py-1 text-[11px] text-[var(--text-secondary)] hover:text-white"
        >
          Action
        </button>
        <button
          type="button"
          disabled={multiViewBusy}
          onClick={() => void onApplyMultiViewToMannequin()}
          data-testid="mannequin-2d-pose-ref-btn"
          title="Pose built-in mannequin driver from Multi-View Front, Side & Rear pose references"
          className={`rounded border py-1 text-[10px] font-semibold transition-colors disabled:opacity-50 ${
            multiViewReadyCount > 0
              ? 'border-[var(--accent-mint)]/60 bg-[var(--accent-mint)]/15 text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/25'
              : 'border-[var(--accent-sakura)]/45 bg-[var(--accent-sakura)]/12 text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/25'
          }`}
        >
          {multiViewBusy ? 'Solving…' : '2D Pose Ref'}
        </button>
      </div>

      {multiViewNote && (
        <div
          data-testid="mannequin-multiview-note"
          className="rounded border border-[var(--accent-mint)]/30 bg-[var(--accent-mint)]/10 px-2 py-1 text-[10px] text-[var(--accent-mint)]"
        >
          {multiViewNote}
        </div>
      )}

      {/* Manual Mannequin Skeleton Bone Controls (Rotate or Move node bones in 3D or via sliders) */}
      <div className="rounded border border-white/10 bg-[var(--surface-1)] p-2 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-[10px] font-semibold text-[var(--text-primary)]">
            Mannequin Bone Node
          </span>
          <div className="flex items-center gap-1">
            <div className="inline-flex rounded border border-white/15 overflow-hidden text-[10px]">
              <button
                type="button"
                onClick={() => setGizmoMode('rotate')}
                data-testid="mannequin-mode-rotate"
                className={`px-2 py-0.5 font-medium ${
                  gizmoMode === 'rotate'
                    ? 'bg-[var(--accent-sakura)] text-[#0D0F18]'
                    : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-white'
                }`}
              >
                Rotate
              </button>
              <button
                type="button"
                onClick={() => setGizmoMode('move')}
                data-testid="mannequin-mode-move"
                className={`px-2 py-0.5 font-medium ${
                  gizmoMode === 'move'
                    ? 'bg-[var(--accent-mint)] text-[#0D0F18]'
                    : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-white'
                }`}
              >
                Move Node
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                const nextRot = { ...driverState.driverBoneRotations };
                delete nextRot[selectedBone];
                onUpdateDriverRotations(nextRot);
                if (onUpdateDriverPositions) {
                  const nextPos = { ...(driverState.driverBonePositions || {}) };
                  delete nextPos[selectedBone];
                  onUpdateDriverPositions(nextPos);
                }
              }}
              data-testid="mannequin-reset-bone-btn"
              className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:text-white"
            >
              <RotateCcw className="h-2.5 w-2.5" /> Reset Joint
            </button>
          </div>
        </div>

        <select
          value={selectedBone}
          onChange={(e) => setSelectedBone(e.target.value)}
          aria-label="Select Mannequin Bone"
          data-testid="mannequin-bone-select"
          className="w-full rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
        >
          {MANNEQUIN_EDITABLE_BONES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        {gizmoMode === 'rotate' ? (
          <div className="grid grid-cols-1 gap-1 pt-0.5">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} className="block text-[10px] text-[var(--text-secondary)]">
                <div className="flex justify-between font-mono-tech">
                  <span>Rotate {axis.toUpperCase()}</span>
                  <span>
                    {(activeRot[axis] * (180 / Math.PI)).toFixed(0)}° ({activeRot[axis].toFixed(2)} rad)
                  </span>
                </div>
                <input
                  type="range"
                  min={-3.14}
                  max={3.14}
                  step={0.02}
                  value={activeRot[axis]}
                  data-testid={`mannequin-axis-${axis}`}
                  onChange={(e) =>
                    onUpdateDriverRotations({
                      ...driverState.driverBoneRotations,
                      [selectedBone]: {
                        ...activeRot,
                        [axis]: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full accent-[var(--accent-sakura)]"
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1 pt-0.5">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} className="block text-[10px] text-[var(--text-secondary)]">
                <div className="flex justify-between font-mono-tech">
                  <span>Move {axis.toUpperCase()}</span>
                  <span>
                    {activePos[axis] >= 0 ? '+' : ''}
                    {activePos[axis].toFixed(2)} m
                  </span>
                </div>
                <input
                  type="range"
                  min={-1.2}
                  max={1.2}
                  step={0.01}
                  value={activePos[axis]}
                  data-testid={`mannequin-move-${axis}`}
                  onChange={(e) =>
                    onUpdateDriverPositions?.({
                      ...(driverState.driverBonePositions || {}),
                      [selectedBone]: {
                        ...activePos,
                        [axis]: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full accent-[var(--accent-mint)]"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onCopyPoseToTarget}
          className="flex-1 rounded bg-[var(--accent-sakura)]/20 border border-[var(--accent-sakura)]/50 px-2 py-1.5 text-[11px] font-medium text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/30"
          data-testid="mannequin-copy-pose-btn"
        >
          {strings.mannequinCopyPose}
        </button>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={driverState.liveFollow}
            onChange={(e) => onToggleLiveFollow(e.target.checked)}
            className="accent-[var(--accent-mint)]"
          />
          <span>{strings.mannequinLiveFollow}</span>
        </label>
      </div>
    </div>
  );
};
