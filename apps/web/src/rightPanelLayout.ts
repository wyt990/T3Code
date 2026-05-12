/**
 * Below this container width (in CSS pixels), an inline right-side panel
 * (plan sidebar / diff sidebar) would steal too much horizontal space from
 * the chat column or its sibling pane in a merged tab pair, so we promote it
 * to a `RightPanelSheet` floating overlay instead.
 *
 * IMPORTANT: this threshold is meant to be measured against the *container*
 * the chat column lives in (e.g. the ChatView root, or each merged-pair
 * pane), not the viewport — viewport-based media queries can't tell that
 * the main sidebar plus a sibling pane has already eaten half the screen.
 */
export const RIGHT_PANEL_INLINE_LAYOUT_BREAKPOINT_PX = 1180;

/**
 * @deprecated Kept for callers that don't have a container ref handy
 * (e.g. layout heuristics that legitimately want viewport-level info).
 * Prefer `useShouldUseRightPanelSheet(containerRef)` for any decision that
 * concerns whether an inline right-side panel will fit beside the chat
 * column.
 */
export const RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY = `(max-width: ${RIGHT_PANEL_INLINE_LAYOUT_BREAKPOINT_PX}px)`;

/** Matches `PlanSidebar` inline width (`w-[340px]`) so sheet mode does not dominate the viewport. */
const RIGHT_PANEL_SHEET_SIZE_TAILWIND_PLAN = "w-[min(92vw,340px)] max-w-[340px]";

/**
 * Aligns with `DiffPanelInlineSidebar` default `clamp(..., 44rem)` upper bound — wide enough
 * for diffs without spanning most of the screen like the previous 820px cap.
 */
const RIGHT_PANEL_SHEET_SIZE_TAILWIND_DIFF = "w-[min(92vw,44rem)] max-w-[44rem]";

/** 与 `TabBar` / `Plan` 侧栏一致：在 Window Controls Overlay 下为系统标题栏按钮留出垂直空间。 */
export const RIGHT_PANEL_SHEET_SHELL_TAILWIND =
  "p-0 wco:mt-[env(titlebar-area-height)] wco:h-[calc(100%-env(titlebar-area-height))] wco:max-h-[calc(100%-env(titlebar-area-height))]";

/** @deprecated Use `RIGHT_PANEL_SHEET_PLAN_CLASS_NAME` or `RIGHT_PANEL_SHEET_DIFF_CLASS_NAME`. */
export const RIGHT_PANEL_SHEET_CLASS_NAME = `${RIGHT_PANEL_SHEET_SIZE_TAILWIND_PLAN} ${RIGHT_PANEL_SHEET_SHELL_TAILWIND}`;

export const RIGHT_PANEL_SHEET_PLAN_CLASS_NAME = `${RIGHT_PANEL_SHEET_SIZE_TAILWIND_PLAN} ${RIGHT_PANEL_SHEET_SHELL_TAILWIND}`;

export const RIGHT_PANEL_SHEET_DIFF_CLASS_NAME = `${RIGHT_PANEL_SHEET_SIZE_TAILWIND_DIFF} ${RIGHT_PANEL_SHEET_SHELL_TAILWIND}`;
