import { useNavigate } from "@tanstack/react-router";

import { useComposerDraftStore } from "../../composerDraftStore";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../../threadRoutes";
import { useUiStateStore } from "../../uiStateStore";
import { pickFallbackTargetFromTabs } from "../../uiTabsState";
import { suppressClosedTabTargets } from "./tabCloseSuppression";

interface CloseTabsAndSyncRouteArgs {
  tabIds: readonly string[];
  navigate: ReturnType<typeof useNavigate>;
  clearClosedDrafts?: boolean;
}

export function closeTabsAndSyncRoute(args: CloseTabsAndSyncRouteArgs): void {
  const { tabIds, navigate, clearClosedDrafts = true } = args;
  const store = useUiStateStore.getState();
  const tabs = store.tabs;
  if (tabIds.length === 0) {
    return;
  }

  const requested = new Set(tabIds);
  const closableTabIds = tabs.group.tabIds.filter((tabId) => requested.has(tabId));
  if (closableTabIds.length === 0) {
    return;
  }

  const closingSet = new Set(closableTabIds);
  const activeWillClose = tabs.group.activeTabId !== null && closingSet.has(tabs.group.activeTabId);
  const closingDraftIds = clearClosedDrafts
    ? closableTabIds.flatMap((tabId) => {
        const tab = tabs.tabsById[tabId];
        return tab?.target.kind === "draft" ? [tab.target.draftId] : [];
      })
    : [];
  const closedTargets = closableTabIds.flatMap((tabId) => {
    const tab = tabs.tabsById[tabId];
    return tab ? [tab.target] : [];
  });
  suppressClosedTabTargets(closedTargets);

  store.closeTabs(closableTabIds);

  if (closingDraftIds.length > 0) {
    const draftStore = useComposerDraftStore.getState();
    for (const draftId of closingDraftIds) {
      draftStore.clearDraftThread(draftId);
    }
  }

  if (!activeWillClose) {
    return;
  }

  const fallbackTarget = pickFallbackTargetFromTabs(useUiStateStore.getState().tabs);
  if (fallbackTarget?.kind === "server") {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(fallbackTarget.threadRef),
      replace: true,
    });
    return;
  }
  if (fallbackTarget?.kind === "draft") {
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(fallbackTarget.draftId),
      replace: true,
    });
    return;
  }
  void navigate({ to: "/", replace: true });
}
