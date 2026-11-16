import React, { useRef } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

interface PanelSplitterProps {
  /** 'horizontal-drag' renders a vertical bar dragged left/right; 'vertical-drag' renders a horizontal bar dragged up/down */
  axis: 'horizontal-drag' | 'vertical-drag';
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Direction arrow faces toward when NOT collapsed (e.g. 'left' for left sidebar, 'right' for right inspector, 'down' for bottom bar) */
  collapseDirection: 'left' | 'right' | 'down';
  onDragDelta: (deltaPx: number) => void;
  onDoubleClickReset?: () => void;
  label: string;
  testId?: string;
  toggleTestId?: string;
  className?: string;
}

export const PanelSplitter: React.FC<PanelSplitterProps> = ({
  axis,
  collapsed,
  onToggleCollapse,
  collapseDirection,
  onDragDelta,
  onDoubleClickReset,
  label,
  testId,
  toggleTestId,
  className = '',
}) => {
  const lastPosRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const isHorizontalDrag = axis === 'horizontal-drag';

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Do not start drag if user clicked the collapse/expand chevron button inside the bar
    if ((e.target as HTMLElement).closest('button')) return;
    if (collapsed) return;
    e.preventDefault();
    draggingRef.current = true;
    lastPosRef.current = isHorizontalDrag ? e.clientX : e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || lastPosRef.current === null) return;
    const current = isHorizontalDrag ? e.clientX : e.clientY;
    const delta = current - lastPosRef.current;
    if (Math.abs(delta) >= 1) {
      onDragDelta(delta);
      lastPosRef.current = current;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    lastPosRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (collapsed) return;
    const step = e.shiftKey ? 32 : 12;
    if (isHorizontalDrag) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onDragDelta(-step);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onDragDelta(step);
      }
    } else {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onDragDelta(-step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onDragDelta(step);
      }
    }
  };

  const renderChevron = () => {
    if (collapseDirection === 'left') {
      return collapsed ? (
        <ChevronRight className="h-3.5 w-3.5" />
      ) : (
        <ChevronLeft className="h-3.5 w-3.5" />
      );
    }
    if (collapseDirection === 'right') {
      return collapsed ? (
        <ChevronLeft className="h-3.5 w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" />
      );
    }
    return collapsed ? (
      <ChevronUp className="h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5" />
    );
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={isHorizontalDrag ? 'vertical' : 'horizontal'}
      aria-label={label}
      data-testid={testId}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClickReset}
      title={`${label} (Drag to resize · Double-click to reset)`}
      className={`group relative z-20 flex shrink-0 select-none items-center justify-center bg-[#14182a] transition-colors hover:bg-[#1e2542] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-sakura)] ${
        isHorizontalDrag
          ? `w-3 border-x border-white/10 ${collapsed ? 'cursor-default' : 'cursor-col-resize'}`
          : `h-3.5 border-y border-white/10 ${collapsed ? 'cursor-default' : 'cursor-row-resize'}`
      } ${className}`}
    >
      {/* Subtle grip indicator */}
      <div
        className={`pointer-events-none rounded-full bg-white/20 transition-colors group-hover:bg-[var(--accent-sakura)]/70 ${
          isHorizontalDrag ? 'h-8 w-0.5' : 'h-0.5 w-10'
        }`}
      />

      {/* Explicit directional > / < / ^ / v collapse & expand button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapse();
        }}
        data-testid={toggleTestId}
        aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
        title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
        className={`absolute flex items-center justify-center rounded border border-white/15 bg-[#1a2038] text-[#cdd6f4] shadow-sm transition-colors hover:border-[var(--accent-sakura)] hover:bg-[#252d4d] hover:text-white ${
          isHorizontalDrag ? 'h-7 w-4' : 'h-4 w-8'
        }`}
      >
        {renderChevron()}
      </button>
    </div>
  );
};
