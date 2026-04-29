import type { MergedTabPair } from "../../uiTabsState";
import { MAX_MERGED_PAIRS } from "../../uiTabsState";

export type TabDragIntent = "reorder" | "merge";

/**
 * Decide whether a drag gesture should be treated as a "reorder" (default) or
 * a "merge" intent. The user signals merge by holding ⌥/Alt while dragging,
 * matching the convention from common desktop browsers' tab strips and
 * leaving plain drags free for sorting.
 *
 * Accepts the raw boolean rather than an event so callers can extract the
 * modifier from the heterogeneous `DragStartEvent.activatorEvent` (Pointer,
 * Mouse or Keyboard) without leaking those types into this module.
 */
export function decideTabDragIntent(altKeyHeld: boolean): TabDragIntent {
  return altKeyHeld ? "merge" : "reorder";
}

export interface MergeAttemptArgs {
  /** The dragged tab id (active.id). */
  draggedTabId: string;
  /** The drop-target tab id (over.id). */
  targetTabId: string;
  /** Currently merged pairs in the active group. */
  mergedPairs: readonly MergedTabPair[];
}

export type MergeAttemptOutcome =
  | { kind: "ok"; leftTabId: string; rightTabId: string }
  | { kind: "rejected"; reason: "same-tab" | "over-merged" | "cap-reached" };

/**
 * Pre-flight check used by `onDragOver`/`onDragEnd` to decide whether a drag
 * gesture targeting `targetTabId` would be a legal merge. The function does
 * not mutate state; callers either:
 *   1. show "no-drop" feedback on `rejected`; or
 *   2. invoke the store's `mergeTabs(leftTabId, rightTabId)` reducer on `ok`
 *      and surface the boolean it returns to the user.
 *
 * The dragged tab becomes the right side of the new pair so the visual
 * intuition ("I dropped X onto Y, X joins Y on the right") matches the
 * design doc's example flow.
 */
export function evaluateMergeAttempt(args: MergeAttemptArgs): MergeAttemptOutcome {
  const { draggedTabId, targetTabId, mergedPairs } = args;
  if (draggedTabId === targetTabId) {
    return { kind: "rejected", reason: "same-tab" };
  }
  if (isTabInMergedPair(draggedTabId, mergedPairs)) {
    return { kind: "rejected", reason: "over-merged" };
  }
  if (isTabInMergedPair(targetTabId, mergedPairs)) {
    return { kind: "rejected", reason: "over-merged" };
  }
  if (mergedPairs.length >= MAX_MERGED_PAIRS) {
    return { kind: "rejected", reason: "cap-reached" };
  }
  return { kind: "ok", leftTabId: targetTabId, rightTabId: draggedTabId };
}

/**
 * Returns true when `tabId` is a participant in any merged pair. Used to
 * disable sortable wrappers around merged tabs and to short-circuit drop
 * acceptance.
 */
export function isTabInMergedPair(tabId: string, pairs: readonly MergedTabPair[]): boolean {
  return pairs.some((pair) => pair.leftTabId === tabId || pair.rightTabId === tabId);
}

export interface DragOverFeedback {
  /** True when the current drop target should display a "no-drop" cursor. */
  blocked: boolean;
  /** True when the gesture would, on release, perform a merge. */
  isMergeIntent: boolean;
}

export interface DragOverFeedbackArgs {
  draggedTabId: string;
  /** Drop target tab id. `null` when not over any tab. */
  overTabId: string | null;
  intent: TabDragIntent;
  mergedPairs: readonly MergedTabPair[];
}

/**
 * Drives the DOM-level drag visuals (cursor, outline, "merge here" hint).
 * Pure so unit tests can assert against the same inputs the live UI
 * receives.
 */
export function deriveDragOverFeedback(args: DragOverFeedbackArgs): DragOverFeedback {
  const { draggedTabId, overTabId, intent, mergedPairs } = args;
  if (overTabId === null) {
    return { blocked: false, isMergeIntent: false };
  }
  if (intent === "merge") {
    const outcome = evaluateMergeAttempt({
      draggedTabId,
      targetTabId: overTabId,
      mergedPairs,
    });
    return {
      blocked: outcome.kind === "rejected" && outcome.reason !== "same-tab",
      isMergeIntent: outcome.kind === "ok",
    };
  }
  // Reorder intent. Hover over a merged-pair slot is not actionable as a
  // reorder either (the pair occupies the slot of its left member, and we
  // currently disallow re-inserting between merged members).
  return {
    blocked: isTabInMergedPair(overTabId, mergedPairs),
    isMergeIntent: false,
  };
}
