import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime";
import { describe, expect, it } from "vitest";

import { DraftId } from "../../draftId";
import {
  createTab,
  initialTabsState,
  MAX_TABS,
  type Tab,
  type TabTarget,
  type UiTabsState,
} from "../../uiTabsState";
import {
  buildTabBarItemGroups,
  decideTabActivation,
  nextTabId,
  pickAutoMergeCandidate,
  pickLeastRecentlyVisitedTabId,
  pickNextActiveTabAfterClose,
  resolveTabTitle,
  tabTargetKey,
} from "./TabBar.logic";

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

function buildState(items: Array<{ tabId: string; target: TabTarget }>): UiTabsState {
  let state = initialTabsState;
  for (const { tabId, target } of items) {
    state = createTab(state, target, { newTabId: tabId }).state;
  }
  return state;
}

function makeTab(overrides: Partial<Tab> & Pick<Tab, "id" | "target">): Tab {
  return {
    customTitle: null,
    titleLocked: false,
    diffOpen: false,
    ...overrides,
  };
}

describe("resolveTabTitle - server tab", () => {
  it("uses serverThreadTitle when present", () => {
    const tab = makeTab({ id: "tab-1", target: serverTarget("t-1") });
    expect(resolveTabTitle({ tab, serverThreadTitle: "Refactor login" })).toBe("Refactor login");
  });

  it("falls back to '新会话' when title is null/empty", () => {
    const tab = makeTab({ id: "tab-1", target: serverTarget("t-1") });
    expect(resolveTabTitle({ tab, serverThreadTitle: null })).toBe("新会话");
    expect(resolveTabTitle({ tab, serverThreadTitle: "   " })).toBe("新会话");
    expect(resolveTabTitle({ tab })).toBe("新会话");
  });

  it("trims surrounding whitespace from server titles", () => {
    const tab = makeTab({ id: "tab-1", target: serverTarget("t-1") });
    expect(resolveTabTitle({ tab, serverThreadTitle: "  Hello  " })).toBe("Hello");
  });
});

describe("resolveTabTitle - draft tab", () => {
  it("prefixes with '草稿 · ' and uses first non-empty line", () => {
    const tab = makeTab({ id: "tab-1", target: draftTarget("d-1") });
    expect(resolveTabTitle({ tab, draftPrompt: "Hello world" })).toBe("草稿 · Hello world");
  });

  it("skips leading blank lines", () => {
    const tab = makeTab({ id: "tab-1", target: draftTarget("d-1") });
    expect(resolveTabTitle({ tab, draftPrompt: "\n\n   \nFirst real line\nSecond" })).toBe(
      "草稿 · First real line",
    );
  });

  it("truncates long prompts to 50 chars with ellipsis", () => {
    const tab = makeTab({ id: "tab-1", target: draftTarget("d-1") });
    const longLine = "a".repeat(80);
    const result = resolveTabTitle({ tab, draftPrompt: longLine });
    expect(result.startsWith("草稿 · ")).toBe(true);
    const body = result.slice("草稿 · ".length);
    expect(body.length).toBe(51); // 50 chars + ellipsis
    expect(body.endsWith("…")).toBe(true);
  });

  it("falls back to '未命名' when prompt is empty/whitespace", () => {
    const tab = makeTab({ id: "tab-1", target: draftTarget("d-1") });
    expect(resolveTabTitle({ tab, draftPrompt: "" })).toBe("草稿 · 未命名");
    expect(resolveTabTitle({ tab, draftPrompt: "   \n  " })).toBe("草稿 · 未命名");
    expect(resolveTabTitle({ tab })).toBe("草稿 · 未命名");
  });
});

describe("resolveTabTitle - locked custom title", () => {
  it("returns customTitle when titleLocked is true", () => {
    const tab = makeTab({
      id: "tab-1",
      target: serverTarget("t-1"),
      customTitle: "My pinned tab",
      titleLocked: true,
    });
    expect(resolveTabTitle({ tab, serverThreadTitle: "Original" })).toBe("My pinned tab");
  });

  it("ignores customTitle when titleLocked is false", () => {
    const tab = makeTab({
      id: "tab-1",
      target: serverTarget("t-1"),
      customTitle: "Stale",
      titleLocked: false,
    });
    expect(resolveTabTitle({ tab, serverThreadTitle: "Fresh" })).toBe("Fresh");
  });

  it("ignores empty/whitespace customTitle even when locked", () => {
    const tab = makeTab({
      id: "tab-1",
      target: serverTarget("t-1"),
      customTitle: "   ",
      titleLocked: true,
    });
    expect(resolveTabTitle({ tab, serverThreadTitle: "Fresh" })).toBe("Fresh");
  });
});

describe("resolveTabTitle - project short name prefix", () => {
  it("prepends project short name when provided", () => {
    const tab = makeTab({ id: "tab-1", target: serverTarget("t-1") });
    expect(resolveTabTitle({ tab, serverThreadTitle: "Login flow", projectShortName: "WEB" })).toBe(
      "WEB: Login flow",
    );
  });

  it("ignores empty short name", () => {
    const tab = makeTab({ id: "tab-1", target: serverTarget("t-1") });
    expect(resolveTabTitle({ tab, serverThreadTitle: "Login", projectShortName: "  " })).toBe(
      "Login",
    );
  });
});

describe("nextTabId", () => {
  it("returns a string starting with 'tab-'", () => {
    const id = nextTabId();
    expect(id).toMatch(/^tab-/);
  });

  it("returns unique ids on repeated calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(nextTabId());
    }
    expect(ids.size).toBe(50);
  });
});

describe("decideTabActivation", () => {
  it("returns activate-existing when target already has a tab", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const decision = decideTabActivation(state, serverTarget("t-1"));
    expect(decision).toEqual({ action: "activate-existing", tabId: "tab-1", alreadyActive: false });
  });

  it("flags alreadyActive when target matches the active tab", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const decision = decideTabActivation(state, serverTarget("t-1"));
    expect(decision).toEqual({ action: "activate-existing", tabId: "tab-1", alreadyActive: true });
  });

  it("returns 'create' when under MAX_TABS and target is new", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const decision = decideTabActivation(state, serverTarget("t-2"));
    expect(decision).toEqual({ action: "create" });
  });

  it("returns 'exceeds-limit' when at MAX_TABS", () => {
    const items = Array.from({ length: MAX_TABS }, (_, i) => ({
      tabId: `tab-${i + 1}`,
      target: serverTarget(`t-${i + 1}`),
    }));
    const state = buildState(items);
    const decision = decideTabActivation(state, serverTarget("t-new"));
    expect(decision.action).toBe("exceeds-limit");
  });

  it("matches drafts by draftId", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: draftTarget("d-1") },
    ]);
    const decision = decideTabActivation(state, draftTarget("d-1"));
    expect(decision).toEqual({ action: "activate-existing", tabId: "tab-2", alreadyActive: true });
  });
});

describe("pickLeastRecentlyVisitedTabId", () => {
  it("returns the tab with the oldest visited timestamp, excluding active", () => {
    const items = Array.from({ length: MAX_TABS }, (_, i) => ({
      tabId: `tab-${i + 1}`,
      target: serverTarget(`t-${i + 1}`),
    }));
    const state = buildState(items);
    // tab-6 is active (last created). Make tab-3 the oldest visited.
    const visited: Record<string, string> = {
      [scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-1") })]: "2026-01-05",
      [scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-2") })]: "2026-01-04",
      [scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-3") })]: "2026-01-01",
      [scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-4") })]: "2026-01-02",
      [scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-5") })]: "2026-01-03",
      [scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-6") })]: "2026-01-06",
    };
    const result = pickLeastRecentlyVisitedTabId(state, visited);
    expect(result).toBe("tab-3");
  });

  it("treats tabs with no visited timestamp as oldest", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: serverTarget("t-3") },
    ]);
    const visited: Record<string, string> = {
      [scopedThreadKey({ environmentId: ENV, threadId: ThreadId.make("t-1") })]: "2026-01-01",
    };
    // active = tab-3; tab-1 has visited, tab-2 has no visited entry → tab-2 is oldest
    const result = pickLeastRecentlyVisitedTabId(state, visited);
    expect(result).toBe("tab-2");
  });

  it("returns null when only the active tab exists", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    const result = pickLeastRecentlyVisitedTabId(state, {});
    expect(result).toBeNull();
  });
});

describe("pickNextActiveTabAfterClose", () => {
  it("returns null when closing the last tab", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    expect(pickNextActiveTabAfterClose(state, "tab-1")).toBeNull();
  });

  it("preserves activeTabId when closing a non-active tab", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: serverTarget("t-3") },
    ]);
    // active = tab-3 (most recent created); close tab-1
    expect(pickNextActiveTabAfterClose(state, "tab-1")).toBe("tab-3");
  });

  it("picks the right neighbor when closing the active tab in the middle", () => {
    const items = [
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: serverTarget("t-3") },
    ];
    let state = buildState(items);
    state = { ...state, group: { ...state.group, activeTabId: "tab-2" } };
    expect(pickNextActiveTabAfterClose(state, "tab-2")).toBe("tab-3");
  });

  it("picks the left neighbor when closing the rightmost active tab", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    // active = tab-2; close tab-2 → fallback to tab-1
    expect(pickNextActiveTabAfterClose(state, "tab-2")).toBe("tab-1");
  });

  it("returns activeTabId unchanged when the removed id is unknown", () => {
    const state = buildState([{ tabId: "tab-1", target: serverTarget("t-1") }]);
    expect(pickNextActiveTabAfterClose(state, "missing")).toBe("tab-1");
  });
});

describe("tabTargetKey", () => {
  it("encodes server targets distinctly from drafts", () => {
    expect(tabTargetKey(serverTarget("t-1"))).toMatch(/^server:/);
    expect(tabTargetKey(draftTarget("d-1"))).toBe("draft:d-1");
  });

  it("returns identical keys for equal targets", () => {
    expect(tabTargetKey(serverTarget("t-1"))).toBe(tabTargetKey(serverTarget("t-1")));
  });
});

describe("buildTabBarItemGroups", () => {
  function tabsFromState(state: UiTabsState): Tab[] {
    return state.group.tabIds.flatMap((id) => {
      const tab = state.tabsById[id];
      return tab ? [tab] : [];
    });
  }

  it("returns single-tab groups when no merges exist", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
    ]);
    const groups = buildTabBarItemGroups(tabsFromState(state), state.group.mergedPairs);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ kind: "single", tab: state.tabsById["tab-1"] });
    expect(groups[1]).toEqual({ kind: "single", tab: state.tabsById["tab-2"] });
  });

  it("folds a merged pair into one slot at the left tab's position", () => {
    const state: UiTabsState = {
      tabsById: {
        "tab-1": {
          id: "tab-1",
          target: serverTarget("t-1"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
        "tab-2": {
          id: "tab-2",
          target: serverTarget("t-2"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
        "tab-3": {
          id: "tab-3",
          target: serverTarget("t-3"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
      },
      group: {
        id: "default",
        tabIds: ["tab-1", "tab-2", "tab-3"],
        activeTabId: "tab-1",
        focusedTabId: "tab-1",
        mergedPairs: [{ leftTabId: "tab-2", rightTabId: "tab-3", splitRatio: 0.5 }],
      },
    };
    const groups = buildTabBarItemGroups(tabsFromState(state), state.group.mergedPairs);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ kind: "single", tab: state.tabsById["tab-1"] });
    expect(groups[1]).toMatchObject({
      kind: "merged",
      leftTab: { id: "tab-2" },
      rightTab: { id: "tab-3" },
    });
  });

  it("skips inconsistent pair entries (missing tab) and falls back to single", () => {
    const state: UiTabsState = {
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
        id: "default",
        tabIds: ["tab-1"],
        activeTabId: "tab-1",
        focusedTabId: "tab-1",
        // Phantom pair pointing at a tab we don't have.
        mergedPairs: [{ leftTabId: "tab-1", rightTabId: "ghost", splitRatio: 0.5 }],
      },
    };
    const groups = buildTabBarItemGroups(tabsFromState(state), state.group.mergedPairs);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ kind: "single", tab: state.tabsById["tab-1"] });
  });
});

describe("pickAutoMergeCandidate", () => {
  it("returns null when fewer than two tabs exist", () => {
    expect(pickAutoMergeCandidate(buildState([]))).toBeNull();
    expect(
      pickAutoMergeCandidate(buildState([{ tabId: "tab-1", target: serverTarget("t-1") }])),
    ).toBeNull();
  });

  it("returns the rightmost adjacent pair of stand-alone tabs", () => {
    const state = buildState([
      { tabId: "tab-1", target: serverTarget("t-1") },
      { tabId: "tab-2", target: serverTarget("t-2") },
      { tabId: "tab-3", target: serverTarget("t-3") },
    ]);
    expect(pickAutoMergeCandidate(state)).toEqual({
      leftTabId: "tab-2",
      rightTabId: "tab-3",
    });
  });

  it("skips already-merged neighbours", () => {
    const tabs: UiTabsState = {
      tabsById: {
        "tab-1": {
          id: "tab-1",
          target: serverTarget("t-1"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
        "tab-2": {
          id: "tab-2",
          target: serverTarget("t-2"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
        "tab-3": {
          id: "tab-3",
          target: serverTarget("t-3"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
        "tab-4": {
          id: "tab-4",
          target: serverTarget("t-4"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
      },
      group: {
        id: "default",
        tabIds: ["tab-1", "tab-2", "tab-3", "tab-4"],
        activeTabId: "tab-1",
        focusedTabId: "tab-1",
        // tab-3 + tab-4 already merged → skip them; expect tab-1 + tab-2.
        mergedPairs: [{ leftTabId: "tab-3", rightTabId: "tab-4", splitRatio: 0.5 }],
      },
    };
    expect(pickAutoMergeCandidate(tabs)).toEqual({ leftTabId: "tab-1", rightTabId: "tab-2" });
  });

  it("returns null when no two stand-alone neighbours exist", () => {
    const tabs: UiTabsState = {
      tabsById: {
        "tab-1": {
          id: "tab-1",
          target: serverTarget("t-1"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
        "tab-2": {
          id: "tab-2",
          target: serverTarget("t-2"),
          customTitle: null,
          titleLocked: false,
          diffOpen: false,
        },
      },
      group: {
        id: "default",
        tabIds: ["tab-1", "tab-2"],
        activeTabId: "tab-1",
        focusedTabId: "tab-1",
        mergedPairs: [{ leftTabId: "tab-1", rightTabId: "tab-2", splitRatio: 0.5 }],
      },
    };
    expect(pickAutoMergeCandidate(tabs)).toBeNull();
  });
});
