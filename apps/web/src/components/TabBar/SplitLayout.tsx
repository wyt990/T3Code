import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { pointerXToSplitRatio, snapToHalfRatio } from "./SplitLayout.logic";

export interface SplitLayoutProps {
  /** Content rendered in the left pane. */
  leftPanel: ReactNode;
  /** Content rendered in the right pane. */
  rightPanel: ReactNode;
  /** Width of the left pane as a fraction of the container (0..1). */
  splitRatio: number;
  /**
   * Called continuously during drag with the clamped next ratio so the caller
   * can update the persisted value. The component does not maintain a local
   * mirror — the parent owns the state of record.
   */
  onSplitRatioChange: (next: number) => void;
  /** Which side currently owns global focus. Drives the outline indicator. */
  focusedSide: "left" | "right";
  /** Activate left side: clicking anywhere in the left pane invokes this. */
  onRequestFocusLeft: () => void;
  /** Activate right side: clicking anywhere in the right pane invokes this. */
  onRequestFocusRight: () => void;
  /** Optional className passthrough so callers can size the layout. */
  className?: string;
}

const HANDLE_WIDTH_PX = 4;

/**
 * Horizontal split-pane container. Phase 2 scope:
 * - Two side-by-side panes whose widths follow `splitRatio`
 * - Mouse-drag handle in the middle (clamped 20%/80% via `pointerXToSplitRatio`)
 * - Click anywhere on a pane → call `onRequestFocus{Left,Right}` so the parent
 *   can promote that side as the focused tab
 * - 1px outline on the focused side (visual focus indicator from the design)
 *
 * The component is intentionally controlled: the parent persists `splitRatio`
 * to the tab store so the value survives unmount and shows up on reload. The
 * drag handler debounces nothing — every pointermove issues a callback so the
 * preview is exact. Callers that want throttling should wrap the prop.
 */
export function SplitLayout(props: Readonly<SplitLayoutProps>) {
  const {
    leftPanel,
    rightPanel,
    splitRatio,
    onSplitRatioChange,
    focusedSide,
    onRequestFocusLeft,
    onRequestFocusRight,
    className,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDragging) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const next = pointerXToSplitRatio({
        pointerX: event.clientX,
        containerLeft: rect.left,
        containerWidth: rect.width,
      });
      if (next === null) return;
      onSplitRatioChange(snapToHalfRatio(next));
    },
    [isDragging, onSplitRatioChange],
  );

  const stopDragging = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      // Keyboard nudges for accessibility: arrow keys move the divider 2% per
      // press, Home/End jump to the bounds.
      const STEP = 0.02;
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = splitRatio - STEP;
      else if (event.key === "ArrowRight") next = splitRatio + STEP;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = 1;
      if (next === null) return;
      event.preventDefault();
      const clamped = pointerXToSplitRatio({
        pointerX: next,
        containerLeft: 0,
        containerWidth: 1,
      });
      if (clamped !== null) onSplitRatioChange(clamped);
    },
    [onSplitRatioChange, splitRatio],
  );

  // While dragging, paint a `cursor: col-resize` over the whole document so the
  // pointer doesn't snap back to the panel cursors when crossing pane edges.
  useEffect(() => {
    if (!isDragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [isDragging]);

  const leftFlex = `${(splitRatio * 100).toFixed(2)}%`;
  const rightFlex = `${((1 - splitRatio) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      data-testid="split-layout"
      className={cn("flex h-full min-h-0 w-full flex-row overflow-hidden", className)}
    >
      <Pane
        side="left"
        focused={focusedSide === "left"}
        onRequestFocus={onRequestFocusLeft}
        flexBasis={leftFlex}
      >
        {leftPanel}
      </Pane>
      <button
        type="button"
        role="separator"
        aria-label="Resize split panes"
        aria-orientation="vertical"
        aria-valuenow={Math.round(splitRatio * 100)}
        aria-valuemin={20}
        aria-valuemax={80}
        data-testid="split-layout-handle"
        data-dragging={isDragging ? "true" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onKeyDown={onKeyDown}
        style={{ width: `${HANDLE_WIDTH_PX}px` }}
        className={cn(
          "shrink-0 cursor-col-resize border-x border-transparent bg-border/40",
          "transition-colors hover:bg-primary/40",
          "focus-visible:bg-primary focus-visible:outline-none",
          isDragging && "bg-primary",
        )}
      />
      <Pane
        side="right"
        focused={focusedSide === "right"}
        onRequestFocus={onRequestFocusRight}
        flexBasis={rightFlex}
      >
        {rightPanel}
      </Pane>
    </div>
  );
}

interface PaneProps {
  side: "left" | "right";
  focused: boolean;
  onRequestFocus: () => void;
  flexBasis: string;
  children: ReactNode;
}

function Pane(props: Readonly<PaneProps>) {
  const { side, focused, onRequestFocus, flexBasis, children } = props;
  const handleMouseDownCapture = useCallback(() => {
    if (focused) return;
    onRequestFocus();
  }, [focused, onRequestFocus]);
  return (
    <section
      data-testid={`split-layout-pane-${side}`}
      data-pane-side={side}
      data-pane-focused={focused ? "true" : undefined}
      onMouseDownCapture={handleMouseDownCapture}
      style={{ flexBasis, minWidth: 0 }}
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden",
        focused
          ? "outline outline-1 -outline-offset-1 outline-primary/60"
          : "outline outline-1 -outline-offset-1 outline-transparent",
      )}
    >
      {children}
    </section>
  );
}
