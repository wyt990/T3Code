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
        if (tab?.target.kind === "draft") {
          return [tab.target.draftId];
        }
        return [];
      })
    : [];
  const closedTargets = closableTabIds.flatMap((tabId) => {
    const tab = tabs.tabsById[tabId];
    return tab ? [tab.target] : [];
  });
  suppressClosedTabTargets(closedTargets);

  console.log(
    "%c【关闭导航】准备关闭标签并导航",
    "background:#ef4444;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
    {
      关闭IDs: closableTabIds,
      active将关闭: activeWillClose,
      关闭草稿IDs: closingDraftIds,
      调用栈: new Error().stack?.split("\n").slice(2, 6).join(" → "),
    },
  );

  store.closeTabs(closableTabIds);

  if (closingDraftIds.length > 0) {
    const draftStore = useComposerDraftStore.getState();
    for (const draftId of closingDraftIds) {
      draftStore.clearDraftThread(draftId);
    }
  }

  if (!activeWillClose) {
    console.log(
      "%c【关闭导航】active 未关闭，无需导航",
      "background:#6b7280;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
    );
    return;
  }

  const fallbackTarget = pickFallbackTargetFromTabs(useUiStateStore.getState().tabs);
  console.log(
    "%c【关闭导航】导航到 fallback 目标",
    "background:#f59e0b;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
    {
      fallbackTarget: fallbackTarget
        ? fallbackTarget.kind === "server"
          ? `会话(${fallbackTarget.threadRef.environmentId}/${fallbackTarget.threadRef.threadId})`
          : fallbackTarget.kind === "draft"
            ? `草稿(${fallbackTarget.draftId})`
            : `文件(${fallbackTarget.filePath})`
        : "(无，导航到首页)",
    },
  );
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
