import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_WORKSPACE_IDS,
  isActiveWorkspaceId,
  isRemovedWorkspaceId,
  clampTimelineDuration,
  sanitizeProjectManifest,
} from './studio';
import { validateBundleSizes, detectModelFormat } from './characters';
import { normalizePoseCategory, validateRasterSettings } from './pose-raster';

test('workspace navigation keeps exact 5 active menus and excludes removed menus', () => {
  assert.deepEqual(ACTIVE_WORKSPACE_IDS, [
    'animation',
    'characters',
    'pose',
    'poseLibrary',
    'assets',
  ]);
  assert.equal(isActiveWorkspaceId('poseLibrary'), true);
  assert.equal(isRemovedWorkspaceId('aiVideo'), true);
  assert.equal(isRemovedWorkspaceId('motionReference'), true);
  assert.equal(isRemovedWorkspaceId('customCharacter'), true);
  assert.equal(isActiveWorkspaceId('customCharacter'), false);
});

test('timeline duration is clamped between 1 and 600 seconds', () => {
  assert.equal(clampTimelineDuration(0), 1);
  assert.equal(clampTimelineDuration(65), 65);
  assert.equal(clampTimelineDuration(1200), 600);
  assert.equal(clampTimelineDuration(Number.NaN), 10);
});

test('project manifest sanitizer preserves legacy customization without enabling removed menus', () => {
  const sanitized = sanitizeProjectManifest({
    name: 'Kuno Scene',
    timelineMode: 'pose_keyframes',
    timelineDurationSec: 90,
    legacyCustomization: { baseMeshVisible: true, components: [{ id: 'c1' }] },
  });
  assert.equal(sanitized.timelineMode, 'pose_keyframes');
  assert.equal(sanitized.timelineDurationSec, 90);
  assert.deepEqual(sanitized.legacyCustomization, {
    baseMeshVisible: true,
    components: [{ id: 'c1' }],
  });
});

test('character bundle size validator enforces 128 MiB single file and 200 MiB bundle caps', () => {
  const ok = validateBundleSizes([
    { name: 'kuno.fbx', sizeBytes: 73 * 1024 * 1024 },
    { name: 'base.png', sizeBytes: 8 * 1024 * 1024 },
  ]);
  assert.equal(ok.ok, true);

  const tooBigSingle = validateBundleSizes([
    { name: 'huge.fbx', sizeBytes: 130 * 1024 * 1024 },
  ]);
  assert.equal(tooBigSingle.ok, false);

  const tooBigBundle = validateBundleSizes([
    { name: 'a.fbx', sizeBytes: 110 * 1024 * 1024 },
    { name: 'b.fbx', sizeBytes: 110 * 1024 * 1024 },
  ]);
  assert.equal(tooBigBundle.ok, false);
  assert.equal(detectModelFormat('Character.GLB'), 'glb');
  assert.equal(detectModelFormat('Prop.obj'), 'obj');
  assert.equal(detectModelFormat('unknown.xyz'), null);
});

test('pose category normalization and raster settings validation are deterministic', () => {
  assert.equal(normalizePoseCategory('Girl'), 'girl');
  assert.equal(normalizePoseCategory('BOY'), 'boy');
  assert.equal(normalizePoseCategory('photo_crowd'), 'unsorted');
  const settings = validateRasterSettings({
    resolutionWidth: 9999,
    celShadowBands: 2,
    selectedViews: ['front', 'side'],
  });
  assert.equal(settings.resolutionWidth, 1024);
  assert.deepEqual(settings.selectedViews, ['front', 'side']);
});
