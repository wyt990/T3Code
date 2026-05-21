import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { useNavigate } from "@tanstack/react-router";

import { closeTabsAndSyncRoute } from "../components/TabBar/tabCloseBehavior";
import { useUiStateStore } from "../uiStateStore";

type NavigateFn = ReturnType<typeof useNavigate>;

export function collectTabIdsForThreadIds(input: {
  readonly environmentId: EnvironmentId;
  readonly threadIds: ReadonlySet<ThreadId> | readonly ThreadId[];
}): string[] {
  const targetSet = input.threadIds instanceof Set ? input.threadIds : new Set(input.threadIds);
  if (targetSet.size === 0) {
    return [];
  }
  const tabs = useUiStateStore.getState().tabs;
  return tabs.group.tabIds.filter((tabId) => {
    const tab = tabs.tabsById[tabId];
    return (
      tab?.target.kind === "server" &&
      tab.target.threadRef.environmentId === input.environmentId &&
      targetSet.has(tab.target.threadRef.threadId)
    );
  });
}

/** Closes all tabs targeting the given threads and navigates away if the active tab was closed. */
export function closeTabsForThreadIds(input: {
  readonly environmentId: EnvironmentId;
  readonly threadIds: readonly ThreadId[];
  readonly navigate: NavigateFn;
}): void {
  const tabIds = collectTabIdsForThreadIds({
    environmentId: input.environmentId,
    threadIds: input.threadIds,
  });
  if (tabIds.length === 0) {
    return;
  }
  closeTabsAndSyncRoute({
    tabIds,
    navigate: input.navigate,
  });
}
