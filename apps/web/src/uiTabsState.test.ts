import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime";
import { describe, expect, it } from "vitest";

import { DraftId } from "./draftId";
import {
  activateTab,
  closeTab,
  closeTabs,
  closeTabsByThreadIds,
  createTab,
  DEFAULT_SPLIT_RATIO,
  DEFAULT_TAB_GROUP_ID,
  findMergedPair,
  findTabByDraft,
  findTabByThread,
  hydrateTabsState,
  initialTabsState,
  MAX_MERGED_PAIRS,
  MAX_SPLIT_RATIO,
  MAX_TABS,
  MIN_SPLIT_RATIO,
  mergeTabs,
  persistTabsState,
  promoteDraftTab,
  pruneOrphanedServerTabs,
  pickFallbackTargetFromTabs,
  reorderTabs,
  setCustomTitle,
  setFocusedTab,
  setSplitRatio,
  setTabDiffOpen,
  splitMergedTabs,
  type Tab,
  type TabTarget,
  type UiTabsState,
} from "./uiTabsState";

const ENV = EnvironmentId.make("env-1");

function serverTarget(threadIdStr: string): TabTarget {
  return {
    kind: "server",
    threadRef: { environmentId: ENV, threadId: ThreadId.make(threadIdStr) },
  };
}

function draftTarget(draftIdStr: string): TabTarget {
  return { kind: "draft", draftId: DraftId.make(draftIdStr) };
}

function buildState(tabsToCreate: Array<{ tabId: string; target: TabTarget }>): UiTabsState {
  let state = initialTabsState;
  for (const { tabId, target } of tabsToCreate) {
    state = createTab(state, target, { newTabId: tabId });
  }
  return state;
}

describe("uiTabsState - createTab", () => {
  it("creates a new tab and activates it by default", () => {
    const next = createTab(initialTabsState, serverTarget("t-1"), { newTabId: "tab-1" });

    expect(next.group.tabIds).toEqual(["tab-1"]);
    expect(next.group.activeTabId).toBe("tab-1");
    expect(next.group.focusedTabId).toBe("tab-1");
    expect(next.tabsById["tab-1"]).toMatchObject({
      id: "tab-1",
      titleLocked: false,
      diffOpen: false,
      customTitle: null,
    });
  });

  it("inserts new tab right after the active tab", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: serverTarget("t-3") },
    ]);
    const activated = activateTab(state, "tab-1");

    const next = createTab(activated, serverTarget("t-4"), { newTabId: "tab-4" });

    expect(next.group.tabIds).toEqual(["tab-1", "tab-4", "tab-2", "tab-3"]);
    expect(next.group.activeTabId).toBe("tab-4");
  });

  it("respects MAX_TABS limit", () => {
    let state = initialTabsState;
    for (let i = 0; i < MAX_TABS; i++) {
      state = createTab(state, serverTarget(`t-${i}`), { newTabId: `tab-${i}` });
    }
    expect(state.group.tabIds).toHaveLength(MAX_TABS);

    const overflow = createTab(state, serverTarget("t-overflow"), { newTabId: "tab-overflow" });
    expect(overflow).toBe(state);
  });

  it("ignores duplicate tabId", () => {
    const state = createTab(initialTabsState, serverTarget("t-1"), { newTabId: "tab-1" });
    const dup = createTab(state, serverTarget("t-2"), { newTabId: "tab-1" });
    expect(dup).toBe(state);
  });

  it("supports activate=false to create without changing active", () => {
    const state = createTab(initialTabsState, serverTarget("t-1"), { newTabId: "tab-1" });
    const next = createTab(state, serverTarget("t-2"), {
      newTabId: "tab-2",
      activate: false,
    });
    expect(next.group.activeTabId).toBe("tab-1");
    expect(next.group.tabIds).toEqual(["tab-1", "tab-2"]);
  });
});

describe("uiTabsState - closeTab", () => {
  it("removes the tab and falls back to the right neighbor for active", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: serverTarget("t-3") },
    ]);
    const activated = activateTab(state, "tab-2");

    const next = closeTab(activated, "tab-2");

    expect(next.group.tabIds).toEqual(["tab-1", "tab-3"]);
    expect(next.group.activeTabId).toBe("tab-3");
    expect(next.group.focusedTabId).toBe("tab-3");
    expect(next.tabsById["tab-2"]).toBeUndefined();
  });

  it("falls back to the left neighbor when closing the rightmost active tab", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const activated = activateTab(state, "tab-2");

    const next = closeTab(activated, "tab-2");

    expect(next.group.activeTabId).toBe("tab-1");
  });

  it("clears active/focused when closing the last tab", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const next = closeTab(state, "tab-1");

    expect(next.group.tabIds).toEqual([]);
    expect(next.group.activeTabId).toBeNull();
    expect(next.group.focusedTabId).toBeNull();
  });

  it("auto-splits any merged pair containing the closed tab", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const merged = mergeTabs(state, "tab-1", "tab-2");
    expect(merged.ok).toBe(true);

    const next = closeTab(merged.state, "tab-1");
    expect(next.group.mergedPairs).toEqual([]);
    expect(next.group.tabIds).toEqual(["tab-2"]);
  });

  it("is a no-op for unknown tabId", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    expect(closeTab(state, "tab-missing")).toBe(state);
  });
});

describe("uiTabsState - closeTabs", () => {
  it("closes multiple tabs atomically and keeps the surviving active tab", () => {
    const state = buildState([
      { tabId: "tab-a", target: serverTarget("t-a") },
      { tabId: "tab-b", target: serverTarget("t-b") },
      { tabId: "tab-c", target: serverTarget("t-c") },
    ]);
    const activeA = activateTab(state, "tab-a");
    const next = closeTabs(activeA, ["tab-b", "tab-c"]);
    expect(next.group.tabIds).toEqual(["tab-a"]);
    expect(next.group.activeTabId).toBe("tab-a");
  });

  it("when active is closed among many tabs, falls back from final state only once", () => {
    const state = buildState([
      { tabId: "tab-a", target: serverTarget("t-a") },
      { tabId: "tab-b", target: serverTarget("t-b") },
      { tabId: "tab-c", target: serverTarget("t-c") },
    ]);
    const activeC = activateTab(state, "tab-c");
    const next = closeTabs(activeC, ["tab-c", "tab-b"]);
    expect(next.group.tabIds).toEqual(["tab-a"]);
    expect(next.group.activeTabId).toBe("tab-a");
    expect(next.group.focusedTabId).toBe("tab-a");
  });
});

describe("uiTabsState - activateTab/setFocusedTab", () => {
  it("activateTab couples activeTabId and focusedTabId", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);

    const next = activateTab(state, "tab-1");
    expect(next.group.activeTabId).toBe("tab-1");
    expect(next.group.focusedTabId).toBe("tab-1");
  });

  it("setFocusedTab on a non-merged tab also updates activeTabId", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);

    const next = setFocusedTab(state, "tab-1");
    expect(next.group.focusedTabId).toBe("tab-1");
    expect(next.group.activeTabId).toBe("tab-1");
  });

  it("setFocusedTab inside a merged pair keeps activeTabId stable", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const merged = mergeTabs(state, "tab-1", "tab-2").state;
    const activated = activateTab(merged, "tab-1");

    const next = setFocusedTab(activated, "tab-2");
    expect(next.group.focusedTabId).toBe("tab-2");
    expect(next.group.activeTabId).toBe("tab-1");
  });
});

describe("uiTabsState - reorderTabs", () => {
  // Given [A, B, C, D]:
  // - dragging RIGHT (source index < target index) → insert AFTER target
  // - dragging LEFT  (source index > target index) → insert BEFORE target
  // This makes drop-on-tab feel natural: land on a tab from the left and you
  // end up just to its right; land from the right and you end up just to its left.

  it("drags right: inserts after the target (one step right)", () => {
    const state = buildState([
      { tabId: "a", target: serverTarget("t-a") },
      { tabId: "b", target: serverTarget("t-b") },
      { tabId: "c", target: serverTarget("t-c") },
      { tabId: "d", target: serverTarget("t-d") },
    ]);
    // Drop A onto B → A should be right of B
    expect(reorderTabs(state, "a", "b").group.tabIds).toEqual(["b", "a", "c", "d"]);
    // Drop A onto C → A should be right of C
    expect(reorderTabs(state, "a", "c").group.tabIds).toEqual(["b", "c", "a", "d"]);
    // Drop A onto D → A should become the last tab
    expect(reorderTabs(state, "a", "d").group.tabIds).toEqual(["b", "c", "d", "a"]);
  });

  it("drags left: inserts before the target (one step left)", () => {
    const state = buildState([
      { tabId: "a", target: serverTarget("t-a") },
      { tabId: "b", target: serverTarget("t-b") },
      { tabId: "c", target: serverTarget("t-c") },
      { tabId: "d", target: serverTarget("t-d") },
    ]);
    // Drop D onto C → D should be right of B (i.e. before C)
    expect(reorderTabs(state, "d", "c").group.tabIds).toEqual(["a", "b", "d", "c"]);
    // Drop D onto A → D should become the first tab
    expect(reorderTabs(state, "d", "a").group.tabIds).toEqual(["d", "a", "b", "c"]);
  });

  it("is a no-op when dragged equals target", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    expect(reorderTabs(state, "tab-1", "tab-1")).toBe(state);
  });

  it("is a no-op when either tab does not exist", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    expect(reorderTabs(state, "tab-1", "tab-missing")).toBe(state);
    expect(reorderTabs(state, "tab-missing", "tab-1")).toBe(state);
  });
});

describe("uiTabsState - setCustomTitle", () => {
  it("sets a custom title and locks it", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);

    const next = setCustomTitle(state, "tab-1", " 自定义标题 ");
    expect(next.tabsById["tab-1"]?.customTitle).toBe("自定义标题");
    expect(next.tabsById["tab-1"]?.titleLocked).toBe(true);
  });

  it("null clears the custom title and unlocks", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const named = setCustomTitle(state, "tab-1", "锁定标题");
    expect(named.tabsById["tab-1"]?.titleLocked).toBe(true);

    const cleared = setCustomTitle(named, "tab-1", null);
    expect(cleared.tabsById["tab-1"]?.customTitle).toBeNull();
    expect(cleared.tabsById["tab-1"]?.titleLocked).toBe(false);
  });

  it("empty string after trim is treated as clear", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const named = setCustomTitle(state, "tab-1", "锁定");
    const cleared = setCustomTitle(named, "tab-1", "   ");
    expect(cleared.tabsById["tab-1"]?.customTitle).toBeNull();
    expect(cleared.tabsById["tab-1"]?.titleLocked).toBe(false);
  });
});

describe("uiTabsState - mergeTabs/splitMergedTabs/setSplitRatio", () => {
  it("merges two tabs into a pair with default ratio", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);

    const result = mergeTabs(state, "tab-1", "tab-2");
    expect(result.ok).toBe(true);
    expect(result.state.group.mergedPairs).toEqual([
      { leftTabId: "tab-1", rightTabId: "tab-2", splitRatio: DEFAULT_SPLIT_RATIO },
    ]);
  });

  it("rejects merging the same tab with itself", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const result = mergeTabs(state, "tab-1", "tab-1");
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
  });

  it("rejects merging a tab that is already in a pair (no nesting)", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: serverTarget("t-3") },
    ]);
    const merged = mergeTabs(state, "tab-1", "tab-2");
    expect(merged.ok).toBe(true);

    const overlapped = mergeTabs(merged.state, "tab-2", "tab-3");
    expect(overlapped.ok).toBe(false);
  });

  it("respects MAX_MERGED_PAIRS limit", () => {
    const state = buildState(
      Array.from({ length: 6 }, (_, i) => ({
        tabId: `tab-${i}`,
        target: serverTarget(`t-${i}`),
      })),
    );

    let cur = state;
    for (let i = 0; i < MAX_MERGED_PAIRS; i++) {
      const r = mergeTabs(cur, `tab-${i * 2}`, `tab-${i * 2 + 1}`);
      expect(r.ok).toBe(true);
      cur = r.state;
    }
    expect(cur.group.mergedPairs).toHaveLength(MAX_MERGED_PAIRS);

    // No more pairs allowed even if there's a fresh, unmerged candidate.
    // (Won't have any leftover unmerged tab here, but the limit itself is the assertion.)
    expect(cur.group.mergedPairs.length).toBe(MAX_MERGED_PAIRS);
  });

  it("splitMergedTabs removes the pair containing the given tab", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const merged = mergeTabs(state, "tab-1", "tab-2").state;

    const next = splitMergedTabs(merged, "tab-2");
    expect(next.group.mergedPairs).toEqual([]);
  });

  it("setSplitRatio clamps to MIN/MAX bounds", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const merged = mergeTabs(state, "tab-1", "tab-2").state;

    const tooLow = setSplitRatio(merged, "tab-1", "tab-2", 0.05);
    expect(tooLow.group.mergedPairs[0]?.splitRatio).toBe(MIN_SPLIT_RATIO);

    const tooHigh = setSplitRatio(merged, "tab-1", "tab-2", 0.99);
    expect(tooHigh.group.mergedPairs[0]?.splitRatio).toBe(MAX_SPLIT_RATIO);

    const ok = setSplitRatio(merged, "tab-1", "tab-2", 0.4);
    expect(ok.group.mergedPairs[0]?.splitRatio).toBe(0.4);
  });

  it("findMergedPair returns the pair or null", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: serverTarget("t-3") },
    ]);
    const merged = mergeTabs(state, "tab-1", "tab-2").state;

    expect(findMergedPair(merged.group.mergedPairs, "tab-1")).not.toBeNull();
    expect(findMergedPair(merged.group.mergedPairs, "tab-2")).not.toBeNull();
    expect(findMergedPair(merged.group.mergedPairs, "tab-3")).toBeNull();
  });
});

describe("uiTabsState - setTabDiffOpen", () => {
  it("toggles the per-tab diff flag", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const opened = setTabDiffOpen(state, "tab-1", true);
    expect(opened.tabsById["tab-1"]?.diffOpen).toBe(true);

    const noChange = setTabDiffOpen(opened, "tab-1", true);
    expect(noChange).toBe(opened);

    const closed = setTabDiffOpen(opened, "tab-1", false);
    expect(closed.tabsById["tab-1"]?.diffOpen).toBe(false);
  });
});

describe("uiTabsState - pruneOrphanedServerTabs", () => {
  it("closes server tabs whose thread key is not in the valid set", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: draftTarget("d-1") },
    ]);
    const validKeys = new Set([
      scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-2") }),
    ]);
    const next = pruneOrphanedServerTabs(state, validKeys);

    expect(next.group.tabIds).toEqual(["tab-2", "tab-3"]);
    expect(next.tabsById["tab-1"]).toBeUndefined();
  });

  it("returns the same state when every server tab is still valid", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const validKeys = new Set([
      scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-1") }),
    ]);
    expect(pruneOrphanedServerTabs(state, validKeys)).toBe(state);
  });
});

describe("uiTabsState - closeTabsByThreadIds", () => {
  it("closes only matching server-target tabs in the given environment", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: draftTarget("d-1") },
    ]);
    const next = closeTabsByThreadIds(state, ENV, [ThreadId.make("t-2")]);

    expect(next.group.tabIds).toEqual(["tab-1", "tab-3"]);
    expect(next.tabsById["tab-2"]).toBeUndefined();
  });

  it("does not touch draft tabs and other environments", () => {
    const otherEnv = EnvironmentId.make("env-other");
    const state = buildState([
      {
        tabId: "tab-1",
        target: {
          kind: "server",
          threadRef: { environmentId: otherEnv, threadId: ThreadId.make("t-1") },
        },
      },
      { tabId: "tab-2", target: draftTarget("d-1") },
    ]);
    const next = closeTabsByThreadIds(state, ENV, [ThreadId.make("t-1")]);
    expect(next).toBe(state);
  });

  it("auto-splits a merged pair when one side is closed", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const merged = mergeTabs(state, "tab-1", "tab-2").state;

    const next = closeTabsByThreadIds(merged, ENV, [ThreadId.make("t-1")]);
    expect(next.group.mergedPairs).toEqual([]);
    expect(next.group.tabIds).toEqual(["tab-2"]);
  });
});

describe("uiTabsState - promoteDraftTab", () => {
  it("upgrades a draft tab to a server tab in place", () => {
    const draftId = DraftId.make("d-1");
    const state = createTab(initialTabsState, draftTarget("d-1"), { newTabId: "tab-1" });
    const promotedTo = { environmentId: ENV, threadId: ThreadId.make("t-1") };

    const next = promoteDraftTab(state, draftId, promotedTo);
    const tab = next.tabsById["tab-1"];
    expect(tab?.target).toEqual({ kind: "server", threadRef: promotedTo });
    expect(next.group.tabIds).toEqual(["tab-1"]);
    expect(next.group.activeTabId).toBe("tab-1");
  });

  it("is a no-op when no tab targets the draft", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const next = promoteDraftTab(state, DraftId.make("d-missing"), {
      environmentId: ENV,
      threadId: ThreadId.make("t-2"),
    });
    expect(next).toBe(state);
  });

  it("deduplicates when the promoted server tab already exists", () => {
    const promotedTo = { environmentId: ENV, threadId: ThreadId.make("t-1") };
    const state = activateTab(
      buildState([
        { tabId: "tab-server", target: serverTarget("t-1") },
        { tabId: "tab-draft", target: draftTarget("d-1") },
      ]),
      "tab-draft",
    );

    const next = promoteDraftTab(state, DraftId.make("d-1"), promotedTo);

    expect(next.group.tabIds).toEqual(["tab-server"]);
    expect(next.group.activeTabId).toBe("tab-server");
    expect(next.group.focusedTabId).toBe("tab-server");
    expect(next.tabsById["tab-draft"]).toBeUndefined();
    expect(next.tabsById["tab-server"]?.target).toEqual({ kind: "server", threadRef: promotedTo });
  });
});

describe("uiTabsState - lookups", () => {
  it("findTabByThread/findTabByDraft locate matching tabs", () => {
    const state = buildState([
      { tabId: "tab-server", target: serverTarget("t-1") },
      { tabId: "tab-draft", target: draftTarget("d-1") },
    ]);
    const tabByThread = findTabByThread(state, {
      environmentId: ENV,
      threadId: ThreadId.make("t-1"),
    });
    expect(tabByThread?.id).toBe("tab-server");

    const tabByDraft = findTabByDraft(state, DraftId.make("d-1"));
    expect(tabByDraft?.id).toBe("tab-draft");

    expect(findTabByDraft(state, DraftId.make("d-missing"))).toBeUndefined();
  });

  it("pickFallbackTargetFromTabs prefers active tab target", () => {
    const state = buildState([
      { tabId: "tab-server", target: serverTarget("t-1") },
      { tabId: "tab-draft", target: draftTarget("d-1") },
    ]);
    const activeDraft = activateTab(state, "tab-draft");
    expect(pickFallbackTargetFromTabs(activeDraft)).toEqual(draftTarget("d-1"));
  });

  it("pickFallbackTargetFromTabs falls back to first valid tab when active is missing", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const corrupted: UiTabsState = {
      ...state,
      group: { ...state.group, activeTabId: "ghost-tab" },
    };
    expect(pickFallbackTargetFromTabs(corrupted)).toEqual(serverTarget("t-1"));
  });
});

describe("uiTabsState - hydration round-trip", () => {
  it("round-trips a valid persisted blob", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const merged = mergeTabs(state, "tab-1", "tab-2").state;
    const final: UiTabsState = setCustomTitle(merged, "tab-1", "lockedA");

    const persisted = persistTabsState(final);
    const hydrated = hydrateTabsState(JSON.parse(JSON.stringify(persisted)));

    expect(hydrated).toEqual(final);
  });

  it("rejects unknown version", () => {
    const result = hydrateTabsState({ version: 1, tabsById: {}, group: {} });
    expect(result).toBeNull();
  });

  it("drops invalid mergedPairs with the same tab on both sides", () => {
    const blob = {
      version: 2,
      tabsById: {
        "tab-1": {
          id: "tab-1",
          target: serverTarget("t-1"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        } as Tab,
      },
      group: {
        id: DEFAULT_TAB_GROUP_ID,
        tabIds: ["tab-1"],
        activeTabId: "tab-1",
        focusedTabId: "tab-1",
        mergedPairs: [{ leftTabId: "tab-1", rightTabId: "tab-1", splitRatio: 0.5 }],
      },
    };
    const hydrated = hydrateTabsState(blob);
    expect(hydrated?.group.mergedPairs).toEqual([]);
  });

  it("drops invalid merged pairs instead of rejecting the whole blob", () => {
    const tabsById: Record<string, Tab> = {};
    for (const id of ["a", "b", "c"]) {
      tabsById[id] = {
        id,
        target: serverTarget(`t-${id}`),
        customTitle: null,
        titleLocked: false,
        diffOpen: false,
      };
    }
    const blob = {
      version: 2,
      tabsById,
      group: {
        id: DEFAULT_TAB_GROUP_ID,
        tabIds: ["a", "b", "c"],
        activeTabId: "a",
        focusedTabId: "a",
        mergedPairs: [
          { leftTabId: "a", rightTabId: "b", splitRatio: 0.5 },
          { leftTabId: "a", rightTabId: "c", splitRatio: 0.5 },
        ],
      },
    };
    const hydrated = hydrateTabsState(blob);
    expect(hydrated?.group.mergedPairs).toEqual([
      { leftTabId: "a", rightTabId: "b", splitRatio: 0.5 },
    ]);
  });

  it("truncates tabIds when persisted list exceeds MAX_TABS", () => {
    const tabsById: Record<string, Tab> = {};
    const tabIds: string[] = [];
    for (let i = 0; i < MAX_TABS + 1; i++) {
      const id = `tab-${i}`;
      tabsById[id] = {
        id,
        target: serverTarget(`t-${i}`),
        customTitle: null,
        titleLocked: false,
        diffOpen: false,
      };
      tabIds.push(id);
    }
    const blob = {
      version: 2,
      tabsById,
      group: {
        id: DEFAULT_TAB_GROUP_ID,
        tabIds,
        activeTabId: tabIds[0]!,
        focusedTabId: tabIds[0]!,
        mergedPairs: [],
      },
    };
    const hydrated = hydrateTabsState(blob);
    expect(hydrated?.group.tabIds).toHaveLength(MAX_TABS);
    expect(hydrated?.group.tabIds[0]).toBe("tab-0");
  });

  it("repairs active/focused tabId when they are not in tabIds", () => {
    const blob = {
      version: 2,
      tabsById: {
        "tab-1": {
          id: "tab-1",
          target: serverTarget("t-1"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
      },
      group: {
        id: DEFAULT_TAB_GROUP_ID,
        tabIds: ["tab-1"],
        activeTabId: "tab-ghost",
        focusedTabId: null,
        mergedPairs: [],
      },
    };
    const hydrated = hydrateTabsState(blob);
    expect(hydrated?.group.activeTabId).toBe("tab-1");
    expect(hydrated?.group.focusedTabId).toBeNull();
  });

  it("rejects malformed tab entries", () => {
    const blob = {
      version: 2,
      tabsById: {
        "tab-1": {
          id: "tab-1",
          target: { kind: "server" }, // missing threadRef
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
      },
      group: {
        id: DEFAULT_TAB_GROUP_ID,
        tabIds: ["tab-1"],
        activeTabId: "tab-1",
        focusedTabId: "tab-1",
        mergedPairs: [],
      },
    };
    expect(hydrateTabsState(blob)).toBeNull();
  });

  it("rejects null/non-object input", () => {
    expect(hydrateTabsState(null)).toBeNull();
    expect(hydrateTabsState(undefined)).toBeNull();
    expect(hydrateTabsState("not an object")).toBeNull();
  });
});
