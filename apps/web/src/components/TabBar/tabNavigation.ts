import type { ScopedThreadRef } from "@t3tools/contracts";

import type { useUiStateStore as UseUiStateStoreType } from "../../uiStateStore";
import type { TabTarget } from "../../uiTabsState";

import { decideTabActivation } from "./TabBar.logic";

export type UseUiStateStoreLike = typeof UseUiStateStoreType;

export interface TabAwareNavigationDeps {
  /**
   * The full Zustand store hook. The helper reads `getState()` to inspect tab
   * state and dispatch reducer actions; it never subscribes, so callers can
   * pass it without triggering re-renders.
   */
  useUiStateStore: UseUiStateStoreLike;
  /**
   * Imperative router-style navigation. The helper only ever invokes it after
   * any necessary tab-state pre-mutations (e.g. closing the LRU tab to make
   * room) so that downstream URL → tab sync sees a consistent state.
   */
  navigateToThread: (target: ScopedThreadRef) => void;
  /**
   * Called when at-cap and the helper needs the user to choose between
   * "replace LRU" and cancel. Implementations are expected to surface a
   * non-blocking toast that wires `onReplaceLru` to its primary action.
   *
   * The dev plan asks for a "替换当前 / 替换最久未访问" two-button toast; Phase 1
   * currently exposes the LRU action only and notes the second action as a
   * follow-up polish task. Callers wanting "替换当前" can do so manually by
   * closing the active tab first and then re-issuing navigation.
   */
  showAtCapToast: (args: AtCapToastArgs) => void;
}

export interface AtCapToastArgs {
  threadRef: ScopedThreadRef;
  /**
   * Tab id chosen as the LRU candidate, or `null` when no replaceable tab
   * exists (e.g. only an active tab remains, which can only happen with
   * `MAX_TABS === 1`). When `null`, callers should typically suppress the
   * "replace LRU" action.
   */
  suggestedReplacementTabId: string | null;
  /** Closes `suggestedReplacementTabId` then navigates to `threadRef`. */
  onReplaceLru: () => void;
}

export interface NavigateToThreadOptions {
  /** When true, skip the at-cap toast and silently apply LRU replacement. */
  forceReplaceLruIfFull?: boolean;
}

/**
 * Centralised "click a thread in the sidebar (or wherever)" navigation that
 * respects the tab cap. Behaviour:
 *
 * 1. If the target already has a tab → just navigate. URL → tab sync activates it.
 * 2. If under cap → just navigate. URL → tab sync creates a new tab.
 * 3. If at cap → show a non-blocking toast offering "replace LRU". The toast's
 *    primary action closes the LRU tab and then navigates.
 *
 * `forceReplaceLruIfFull` is provided so non-interactive flows (e.g. plan
 * implementations that auto-navigate to a freshly-promoted thread) can absorb
 * the cap without a confirmation.
 */
export function navigateToThreadWithTabAwareness(
  threadRef: ScopedThreadRef,
  deps: TabAwareNavigationDeps,
  options?: NavigateToThreadOptions,
): void {
  const target: TabTarget = { kind: "server", threadRef };
  const state = deps.useUiStateStore.getState();
  const decision = decideTabActivation(state.tabs, target, state.threadLastVisitedAtById);

  if (decision.action === "activate-existing" || decision.action === "create") {
    deps.navigateToThread(threadRef);
    return;
  }

  // exceeds-limit
  const lruTabId = decision.suggestedReplacementTabId;
  const replaceLru = () => {
    if (lruTabId) {
      deps.useUiStateStore.getState().closeTab(lruTabId);
    } else {
      // No non-active tab to evict (cap=1 corner case). Replace the active
      // one instead so the navigation can proceed.
      const activeId = deps.useUiStateStore.getState().tabs.group.activeTabId;
      if (activeId) {
        deps.useUiStateStore.getState().closeTab(activeId);
      }
    }
    deps.navigateToThread(threadRef);
  };

  if (options?.forceReplaceLruIfFull === true) {
    replaceLru();
    return;
  }

  deps.showAtCapToast({
    threadRef,
    suggestedReplacementTabId: lruTabId,
    onReplaceLru: replaceLru,
  });
}

/**
 * Mint a fresh tab id. Re-exported so callers that explicitly need to seed a
 * tab (rather than relying on URL → tab sync) don't have to dig into the
 * TabBar internals.
 */
export { nextTabId } from "./TabBar.logic";
