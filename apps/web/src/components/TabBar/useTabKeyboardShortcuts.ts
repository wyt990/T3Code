import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import {
  isSidebarFocused,
  resolveShortcutCommand,
  tabsSwitchIndexFromCommand,
  type ShortcutMatchContext,
} from "../../keybindings";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import { findMergedPair, type Tab, type UiTabsState } from "../../uiTabsState";
import { stackedThreadToast, toastManager } from "../ui/toast";

import { pickAutoMergeCandidate } from "./TabBar.logic";

const TABS_TOGGLE_SPLIT_TOAST_TIMEOUT_MS = 5000;

interface ShortcutContextSnapshot {
  context: ShortcutMatchContext;
}

/**
 * Read every "ambient" boolean the keybindings layer cares about at the
 * moment of a global keydown. Sampled fresh per event so transient state
 * (focus changes, model picker open/close) is correctly observed without
 * having to subscribe each component to the relevant stores.
 */
function snapshotShortcutContext(): ShortcutContextSnapshot {
  return {
    context: {
      terminalFocus: isTerminalFocused(),
      terminalOpen: false,
      sidebarFocus: isSidebarFocused(),
    },
  };
}

function getOrderedTabs(tabs: UiTabsState): Tab[] {
  return tabs.group.tabIds.flatMap((id) => {
    const tab = tabs.tabsById[id];
    return tab ? [tab] : [];
  });
}

function pickAdjacentTabId(tabs: UiTabsState, direction: "next" | "prev"): string | null {
  const ids = tabs.group.tabIds;
  if (ids.length === 0) return null;
  const activeId = tabs.group.activeTabId;
  const currentIndex = activeId ? ids.indexOf(activeId) : -1;
  if (currentIndex < 0) {
    return ids[0] ?? null;
  }
  const offset = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + offset + ids.length) % ids.length;
  return ids[nextIndex] ?? null;
}

function pickTabByIndex(tabs: UiTabsState, indexFromZero: number): string | null {
  const ids = tabs.group.tabIds;
  return ids[indexFromZero] ?? null;
}

interface NavigateToTabIdArgs {
  tabId: string;
  navigate: ReturnType<typeof useNavigate>;
}

async function navigateToTabId({ tabId, navigate }: NavigateToTabIdArgs): Promise<void> {
  const tabs = useUiStateStore.getState().tabs;
  const tab = tabs.tabsById[tabId];
  if (!tab) return;
  // Keep activation state in sync immediately so the URL transition does not
  // flicker through the previous active tab while the router resolves.
  useUiStateStore.getState().activateTab(tabId);
  if (tab.target.kind === "server") {
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(tab.target.threadRef),
    });
    return;
  }
  await navigate({
    to: "/draft/$draftId",
    params: buildDraftThreadRouteParams(tab.target.draftId),
  });
}

interface UseTabKeyboardShortcutsArgs {
  /** Resolved keybindings from the server. May be `null` while loading. */
  keybindings: ReturnType<typeof import("../../rpc/serverState").useServerKeybindings>;
}

/**
 * Wires keyboard shortcuts that operate on tabs (close, switch, prev/next,
 * toggle split). Keeps the listener at window-level so it works regardless of
 * which child of the chat shell currently has focus.
 *
 * Coexists with `ChatRouteGlobalShortcuts` (which owns `chat.new`) and
 * `Sidebar`'s own listener (which owns `thread.previous/next` and the
 * `thread.jump.*` family scoped by `sidebarFocus`).
 */
export function useTabKeyboardShortcuts({ keybindings }: UseTabKeyboardShortcutsArgs): void {
  const navigate = useNavigate();

  const handleToggleSplit = useCallback((): void => {
    const store = useUiStateStore.getState();
    const tabs = store.tabs;
    const activeTabId = tabs.group.activeTabId;
    if (!activeTabId) return;

    const existingPair = findMergedPair(tabs.group.mergedPairs, activeTabId);
    if (existingPair) {
      // Already split — collapse it.
      store.splitMergedTabs(activeTabId);
      return;
    }

    // Look for the right neighbour first; fall back to the left neighbour so
    // the shortcut still works on the rightmost tab.
    const ids = tabs.group.tabIds;
    const idx = ids.indexOf(activeTabId);
    const candidates: Array<{ left: string; right: string }> = [];
    if (idx >= 0 && idx + 1 < ids.length) {
      const right = ids[idx + 1];
      if (right) {
        candidates.push({ left: activeTabId, right });
      }
    }
    if (idx > 0) {
      const left = ids[idx - 1];
      if (left) {
        candidates.push({ left, right: activeTabId });
      }
    }

    // Final fallback: any adjacent merge candidate elsewhere in the bar.
    const auto = pickAutoMergeCandidate(tabs);
    if (auto) {
      candidates.push({ left: auto.leftTabId, right: auto.rightTabId });
    }

    for (const candidate of candidates) {
      const ok = store.mergeTabs(candidate.left, candidate.right);
      if (ok) return;
    }

    // No mergeable neighbour — surface a hint instead of silently failing.
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: "无法切换分屏",
        description: "请先在标签栏旁边再打开一个标签，或减少已合并的对数。",
        timeout: TABS_TOGGLE_SPLIT_TOAST_TIMEOUT_MS,
      }),
    );
  }, []);

  const handleAdjacent = useCallback(
    async (direction: "next" | "prev"): Promise<void> => {
      const tabs = useUiStateStore.getState().tabs;
      const targetTabId = pickAdjacentTabId(tabs, direction);
      if (!targetTabId) return;
      await navigateToTabId({ tabId: targetTabId, navigate });
    },
    [navigate],
  );

  const handleSwitchToIndex = useCallback(
    async (indexFromZero: number): Promise<void> => {
      const tabs = useUiStateStore.getState().tabs;
      const targetTabId = pickTabByIndex(tabs, indexFromZero);
      if (!targetTabId) return;
      await navigateToTabId({ tabId: targetTabId, navigate });
    },
    [navigate],
  );

  const handleClose = useCallback((): void => {
    const tabs = useUiStateStore.getState().tabs;
    const activeTabId = tabs.group.activeTabId;
    if (!activeTabId) return;
    useUiStateStore.getState().closeTab(activeTabId);
    // After closing, the URL → tab sync in TabbedShell brings the URL onto the
    // newly-active tab, so we don't navigate explicitly here.
  }, []);

  useEffect(() => {
    if (!keybindings) return;
    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return;
      const snapshot = snapshotShortcutContext();
      const command = resolveShortcutCommand(event, keybindings, {
        context: snapshot.context,
      });
      if (!command) return;

      switch (command) {
        case "tabs.close":
          event.preventDefault();
          event.stopPropagation();
          handleClose();
          return;
        case "tabs.next":
          event.preventDefault();
          event.stopPropagation();
          void handleAdjacent("next");
          return;
        case "tabs.prev":
          event.preventDefault();
          event.stopPropagation();
          void handleAdjacent("prev");
          return;
        case "tabs.toggleSplit":
          event.preventDefault();
          event.stopPropagation();
          handleToggleSplit();
          return;
        default: {
          const tabIndex = tabsSwitchIndexFromCommand(command);
          if (tabIndex !== null) {
            event.preventDefault();
            event.stopPropagation();
            void handleSwitchToIndex(tabIndex);
          }
        }
      }
    };

    globalThis.addEventListener("keydown", onWindowKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [handleAdjacent, handleClose, handleSwitchToIndex, handleToggleSplit, keybindings]);
}
