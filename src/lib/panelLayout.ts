export interface PanelLayoutState {
  navWidthPx: number;
  navCollapsed: boolean;
  inspectorWidthPx: number;
  inspectorHeightPx: number;
  inspectorCollapsed: boolean;
  timelineHeightPx: number;
  timelineCollapsed: boolean;
  stageCollapsed: boolean;
}

export const PANEL_LIMITS = {
  nav: { defaultPx: 192, minPx: 140, maxPx: 300 },
  inspectorW: { defaultPx: 380, minPx: 280, maxPx: 960 },
  inspectorH: { defaultPx: 300, minPx: 140, maxPx: 620 },
  timelineH: { defaultPx: 126, minPx: 76, maxPx: 360 },
} as const;

export const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  navWidthPx: PANEL_LIMITS.nav.defaultPx,
  navCollapsed: false,
  inspectorWidthPx: PANEL_LIMITS.inspectorW.defaultPx,
  inspectorHeightPx: PANEL_LIMITS.inspectorH.defaultPx,
  inspectorCollapsed: false,
  timelineHeightPx: PANEL_LIMITS.timelineH.defaultPx,
  timelineCollapsed: false,
  stageCollapsed: false,
};

const STORAGE_KEY = 'rapuso_panel_layout_v1';

function clampNumber(val: unknown, fallback: number, min: number, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export function clampPanelLayout(input: Partial<PanelLayoutState> | null | undefined): PanelLayoutState {
  const raw = input ?? {};
  return {
    navWidthPx: clampNumber(
      raw.navWidthPx,
      PANEL_LIMITS.nav.defaultPx,
      PANEL_LIMITS.nav.minPx,
      PANEL_LIMITS.nav.maxPx
    ),
    navCollapsed: Boolean(raw.navCollapsed),
    inspectorWidthPx: clampNumber(
      raw.inspectorWidthPx,
      PANEL_LIMITS.inspectorW.defaultPx,
      PANEL_LIMITS.inspectorW.minPx,
      PANEL_LIMITS.inspectorW.maxPx
    ),
    inspectorHeightPx: clampNumber(
      raw.inspectorHeightPx,
      PANEL_LIMITS.inspectorH.defaultPx,
      PANEL_LIMITS.inspectorH.minPx,
      PANEL_LIMITS.inspectorH.maxPx
    ),
    inspectorCollapsed: Boolean(raw.inspectorCollapsed),
    timelineHeightPx: clampNumber(
      raw.timelineHeightPx,
      PANEL_LIMITS.timelineH.defaultPx,
      PANEL_LIMITS.timelineH.minPx,
      PANEL_LIMITS.timelineH.maxPx
    ),
    timelineCollapsed: Boolean(raw.timelineCollapsed),
    stageCollapsed: Boolean(raw.stageCollapsed),
  };
}

export function areAllSurroundingPanelsCollapsed(layout: PanelLayoutState): boolean {
  return (
    !layout.stageCollapsed &&
    layout.navCollapsed &&
    layout.inspectorCollapsed &&
    layout.timelineCollapsed
  );
}

export function toggleFocus3DLayout(prev: PanelLayoutState): PanelLayoutState {
  const allCollapsed = areAllSurroundingPanelsCollapsed(prev);
  return {
    ...prev,
    stageCollapsed: false,
    navCollapsed: !allCollapsed,
    inspectorCollapsed: !allCollapsed,
    timelineCollapsed: !allCollapsed,
  };
}

export function toggleStageMinimizeLayout(prev: PanelLayoutState): PanelLayoutState {
  const nextCollapsed = !prev.stageCollapsed;
  return {
    ...prev,
    stageCollapsed: nextCollapsed,
    inspectorCollapsed: nextCollapsed ? false : prev.inspectorCollapsed,
  };
}

export function loadSavedPanelLayout(): PanelLayoutState {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return DEFAULT_PANEL_LAYOUT;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PANEL_LAYOUT;
    return clampPanelLayout(JSON.parse(raw) as Partial<PanelLayoutState>);
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}

export function savePanelLayout(layout: PanelLayoutState): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clampPanelLayout(layout)));
  } catch {
    // Ignore storage quota errors
  }
}
