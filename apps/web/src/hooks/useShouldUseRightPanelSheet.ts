import { useCallback, useEffect, useState } from "react";

import { RIGHT_PANEL_INLINE_LAYOUT_BREAKPOINT_PX } from "../rightPanelLayout";

export interface UseShouldUseRightPanelSheetResult {
  /**
   * Callback ref to attach to the container whose width drives the
   * inline-vs-sheet decision.
   *
   * Using a callback ref (rather than a stable `RefObject`) is important:
   * the hook's effect needs to react to *node mount/remount* events too,
   * not just to value changes. With a `RefObject` the hook would only run
   * its effect once on mount and miss late-attached nodes (e.g. when the
   * ref is forwarded through a wrapper that spreads `...props.ref`,
   * causing the assignment to land after the hook's effect already ran).
   * Storing the node in state guarantees the effect re-runs whenever the
   * DOM node behind the ref actually changes, which is the lifecycle we
   * actually care about.
   */
  containerRef: (node: HTMLElement | null) => void;
  /** True when the right-side panel should be promoted to a floating sheet. */
  shouldUseSheet: boolean;
}

/**
 * Watches the layout width of the container the returned `containerRef`
 * is attached to and decides whether the right-side panel (plan sidebar /
 * diff sidebar) should render as a floating `RightPanelSheet` overlay or
 * as an inline column.
 *
 * The decision is based on the **container's** width rather than the
 * viewport. The chat column's actual horizontal budget is whatever is
 * left after the main sidebar (and, in merged tabs, the sibling pane)
 * have taken their share — that's not knowable from a viewport-level
 * media query, which is why a 1024×676 startup window that *should* be
 * considered narrow could still resolve to "wide" via `useMediaQuery` and
 * let the inline panel overlap the composer.
 */
export function useShouldUseRightPanelSheet(options?: {
  /** Override threshold; falls back to the shared layout constant. */
  breakpointPx?: number;
  /** Initial value used before the first observed measurement. */
  defaultToSheet?: boolean;
}): UseShouldUseRightPanelSheetResult {
  const breakpointPx = options?.breakpointPx ?? RIGHT_PANEL_INLINE_LAYOUT_BREAKPOINT_PX;
  const defaultToSheet = options?.defaultToSheet ?? false;

  const [containerNode, setContainerNode] = useState<HTMLElement | null>(null);
  const [shouldUseSheet, setShouldUseSheet] = useState<boolean>(defaultToSheet);

  const containerRef = useCallback((node: HTMLElement | null) => {
    setContainerNode(node);
  }, []);

  useEffect(() => {
    if (!containerNode) return;
    if (globalThis.window === undefined || typeof ResizeObserver === "undefined") {
      return;
    }
    // Seed the state from the current width before any ResizeObserver
    // entries fire so we don't render one frame in the wrong mode on mount.
    const seed = containerNode.clientWidth;
    if (seed > 0) {
      setShouldUseSheet(seed < breakpointPx);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Use border-box width when available so the threshold matches what
      // the user actually sees; fall back to contentRect for older engines.
      const borderBox = entry.borderBoxSize?.[0]?.inlineSize;
      const width = typeof borderBox === "number" ? borderBox : entry.contentRect.width;
      if (width <= 0) return;
      setShouldUseSheet(width < breakpointPx);
    });
    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [breakpointPx, containerNode]);

  return { containerRef, shouldUseSheet };
}
