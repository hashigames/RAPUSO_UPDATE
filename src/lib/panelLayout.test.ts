import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areAllSurroundingPanelsCollapsed,
  clampPanelLayout,
  DEFAULT_PANEL_LAYOUT,
  PANEL_LIMITS,
  toggleFocus3DLayout,
  toggleStageMinimizeLayout,
} from './panelLayout';

test('clampPanelLayout enforces min/max bounds across horizontal and vertical dimensions', () => {
  const clamped = clampPanelLayout({
    navWidthPx: 20,
    inspectorWidthPx: 9999,
    inspectorHeightPx: -50,
    timelineHeightPx: 1200,
    navCollapsed: true,
    stageCollapsed: true,
  });

  assert.equal(clamped.navWidthPx, PANEL_LIMITS.nav.minPx);
  assert.equal(clamped.inspectorWidthPx, PANEL_LIMITS.inspectorW.maxPx);
  assert.equal(clamped.inspectorHeightPx, PANEL_LIMITS.inspectorH.minPx);
  assert.equal(clamped.timelineHeightPx, PANEL_LIMITS.timelineH.maxPx);
  assert.equal(clamped.navCollapsed, true);
  assert.equal(clamped.stageCollapsed, true);
});

test('toggleFocus3DLayout collapses and restores all surrounding panels while preserving custom sizes', () => {
  const custom = clampPanelLayout({
    ...DEFAULT_PANEL_LAYOUT,
    navWidthPx: 240,
    inspectorWidthPx: 440,
    timelineHeightPx: 180,
  });

  assert.equal(areAllSurroundingPanelsCollapsed(custom), false);

  const focused = toggleFocus3DLayout(custom);
  assert.equal(areAllSurroundingPanelsCollapsed(focused), true);
  assert.equal(focused.stageCollapsed, false);
  assert.equal(focused.navWidthPx, 240);
  assert.equal(focused.inspectorWidthPx, 440);
  assert.equal(focused.timelineHeightPx, 180);

  const restored = toggleFocus3DLayout(focused);
  assert.equal(areAllSurroundingPanelsCollapsed(restored), false);
  assert.equal(restored.navWidthPx, 240);
  assert.equal(restored.inspectorWidthPx, 440);
  assert.equal(restored.timelineHeightPx, 180);
});

test('toggleStageMinimizeLayout minimizes main 3D stage and keeps inspector open for Mannequin Driver', () => {
  const start = clampPanelLayout({
    ...DEFAULT_PANEL_LAYOUT,
    inspectorCollapsed: true,
    stageCollapsed: false,
  });

  const minimized = toggleStageMinimizeLayout(start);
  assert.equal(minimized.stageCollapsed, true);
  assert.equal(minimized.inspectorCollapsed, false);

  const maximized = toggleFocus3DLayout(minimized);
  assert.equal(maximized.stageCollapsed, false);
  assert.equal(areAllSurroundingPanelsCollapsed(maximized), true);
});
