import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime";
import type { DraftId } from "./draftId";

export const MAX_TABS = 6;
export const MAX_MERGED_PAIRS = 3;
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const DEFAULT_TAB_GROUP_ID = "default";
export const TABS_PERSISTED_VERSION = 2;

export type TabTarget =
  | { kind: "server"; threadRef: ScopedThreadRef }
  | { kind: "draft"; draftId: DraftId };

export interface Tab {
  id: string;
  target: TabTarget;
  customTitle: string | null;
  titleLocked: boolean;
  diffOpen: boolean;
}

export interface MergedTabPair {
  leftTabId: string;
  rightTabId: string;
  splitRatio: number;
}

export interface TabGroup {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
  focusedTabId: string | null;
  mergedPairs: MergedTabPair[];
}

export interface UiTabsState {
  tabsById: Record<string, Tab>;
  group: TabGroup;
}

export interface PersistedTabsState {
  version: typeof TABS_PERSISTED_VERSION;
  tabsById: Record<string, Tab>;
  group: TabGroup;
}

export const initialTabsState: UiTabsState = {
  tabsById: {},
  group: {
    id: DEFAULT_TAB_GROUP_ID,
    tabIds: [],
    activeTabId: null,
    focusedTabId: null,
    mergedPairs: [],
  },
};

function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_SPLIT_RATIO;
  }
  if (ratio < MIN_SPLIT_RATIO) {
    return MIN_SPLIT_RATIO;
  }
  if (ratio > MAX_SPLIT_RATIO) {
    return MAX_SPLIT_RATIO;
  }
  return ratio;
}

function findPairIndexContaining(pairs: readonly MergedTabPair[], tabId: string): number {
  return pairs.findIndex((pair) => pair.leftTabId === tabId || pair.rightTabId === tabId);
}

function isMergedTabId(pairs: readonly MergedTabPair[], tabId: string): boolean {
  return findPairIndexContaining(pairs, tabId) >= 0;
}

export function findMergedPair(
  pairs: readonly MergedTabPair[],
  tabId: string,
): MergedTabPair | null {
  const index = findPairIndexContaining(pairs, tabId);
  return index >= 0 ? (pairs[index] ?? null) : null;
}

export function targetMatchesThread(target: TabTarget, threadRef: ScopedThreadRef): boolean {
  if (target.kind !== "server") {
    return false;
  }
  return (
    target.threadRef.environmentId === threadRef.environmentId &&
    target.threadRef.threadId === threadRef.threadId
  );
}

export function targetMatchesDraft(target: TabTarget, draftId: DraftId): boolean {
  return target.kind === "draft" && target.draftId === draftId;
}

export function findTabByThread(state: UiTabsState, threadRef: ScopedThreadRef): Tab | undefined {
  for (const tabId of state.group.tabIds) {
    const tab = state.tabsById[tabId];
    if (tab && targetMatchesThread(tab.target, threadRef)) {
      return tab;
    }
  }
  return undefined;
}

export function findTabByDraft(state: UiTabsState, draftId: DraftId): Tab | undefined {
  for (const tabId of state.group.tabIds) {
    const tab = state.tabsById[tabId];
    if (tab && targetMatchesDraft(tab.target, draftId)) {
      return tab;
    }
  }
  return undefined;
}

/**
 * Returns the best-effort tab target to navigate to when callers lose the
 * current route context (for example, after closing an active draft route).
 * Prefers the active tab target; if it's missing/corrupt, falls back to the
 * first valid tab in visual order.
 */
export function pickFallbackTargetFromTabs(state: UiTabsState): TabTarget | null {
  const activeTabId = state.group.activeTabId;
  if (activeTabId) {
    const activeTab = state.tabsById[activeTabId];
    if (activeTab) {
      return activeTab.target;
    }
  }
  for (const tabId of state.group.tabIds) {
    const tab = state.tabsById[tabId];
    if (tab) {
      return tab.target;
    }
  }
  return null;
}

function pickFallbackTabId(
  remainingTabIds: readonly string[],
  removedIndex: number,
): string | null {
  if (remainingTabIds.length === 0) {
    return null;
  }
  // After removal at `removedIndex`, the right neighbor sits at the same
  // index in the new array; if that's past the end, fall back to the left.
  const rightCandidate = remainingTabIds[removedIndex];
  if (rightCandidate) {
    return rightCandidate;
  }
  return remainingTabIds[remainingTabIds.length - 1] ?? null;
}

export interface CreateTabOptions {
  newTabId: string;
  insertAfterActive?: boolean;
  activate?: boolean;
}

export function createTab(
  state: UiTabsState,
  target: TabTarget,
  options: CreateTabOptions,
): UiTabsState {
  if (state.group.tabIds.length >= MAX_TABS) {
    return state;
  }
  if (state.tabsById[options.newTabId]) {
    return state;
  }
  const tab: Tab = {
    id: options.newTabId,
    target,
    customTitle: null,
    titleLocked: false,
    diffOpen: false,
  };
  let insertIndex = state.group.tabIds.length;
  if (options.insertAfterActive !== false && state.group.activeTabId) {
    const activeIndex = state.group.tabIds.indexOf(state.group.activeTabId);
    if (activeIndex >= 0) {
      insertIndex = activeIndex + 1;
    }
  }
  const nextTabIds = [...state.group.tabIds];
  nextTabIds.splice(insertIndex, 0, tab.id);
  const shouldActivate = options.activate !== false;
  return {
    tabsById: { ...state.tabsById, [tab.id]: tab },
    group: {
      ...state.group,
      tabIds: nextTabIds,
      activeTabId: shouldActivate ? tab.id : state.group.activeTabId,
      focusedTabId: shouldActivate ? tab.id : state.group.focusedTabId,
    },
  };
}

export function closeTab(state: UiTabsState, tabId: string): UiTabsState {
  if (!state.tabsById[tabId]) {
    return state;
  }
  const removedIndex = state.group.tabIds.indexOf(tabId);
  if (removedIndex < 0) {
    return state;
  }
  const nextTabIds = state.group.tabIds.filter((id) => id !== tabId);
  const nextMergedPairs = state.group.mergedPairs.filter(
    (pair) => pair.leftTabId !== tabId && pair.rightTabId !== tabId,
  );
  const nextTabsById = { ...state.tabsById };
  delete nextTabsById[tabId];
  const fallbackTabId = pickFallbackTabId(nextTabIds, removedIndex);
  const nextGroup: TabGroup = {
    ...state.group,
    tabIds: nextTabIds,
    mergedPairs: nextMergedPairs,
    activeTabId: state.group.activeTabId === tabId ? fallbackTabId : state.group.activeTabId,
    focusedTabId: state.group.focusedTabId === tabId ? fallbackTabId : state.group.focusedTabId,
  };
  return {
    tabsById: nextTabsById,
    group: nextGroup,
  };
}

/**
 * Closes multiple tabs in one reducer pass. Unknown ids are ignored. The
 * resulting active/focused selection follows the same fallback semantics as
 * repeated `closeTab`, but callers can compute navigation once from the final
 * state instead of per-tab side effects.
 */
export function closeTabs(state: UiTabsState, tabIds: readonly string[]): UiTabsState {
  if (tabIds.length === 0) {
    return state;
  }
  const requested = new Set(tabIds);
  const closable = state.group.tabIds.filter((tabId) => requested.has(tabId));
  if (closable.length === 0) {
    return state;
  }
  let next = state;
  for (const tabId of closable) {
    next = closeTab(next, tabId);
  }
  return next;
}

export function activateTab(state: UiTabsState, tabId: string): UiTabsState {
  if (!state.tabsById[tabId]) {
    return state;
  }
  if (state.group.activeTabId === tabId && state.group.focusedTabId === tabId) {
    return state;
  }
  return {
    ...state,
    group: {
      ...state.group,
      activeTabId: tabId,
      focusedTabId: tabId,
    },
  };
}

export function setFocusedTab(state: UiTabsState, tabId: string): UiTabsState {
  if (!state.tabsById[tabId]) {
    return state;
  }
  if (state.group.focusedTabId === tabId) {
    return state;
  }
  const pair = findMergedPair(state.group.mergedPairs, tabId);
  // Outside of a merged pair, focus and active are coupled.
  return {
    ...state,
    group: {
      ...state.group,
      focusedTabId: tabId,
      activeTabId: pair === null ? tabId : state.group.activeTabId,
    },
  };
}

export function reorderTabs(
  state: UiTabsState,
  draggedTabId: string,
  targetTabId: string,
): UiTabsState {
  if (draggedTabId === targetTabId) {
    return state;
  }
  const draggedIndex = state.group.tabIds.indexOf(draggedTabId);
  const targetIndex = state.group.tabIds.indexOf(targetTabId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return state;
  }
  const next = [...state.group.tabIds];
  next.splice(draggedIndex, 1);
  const adjustedTargetIndex = next.indexOf(targetTabId);
  // When dragging rightward (source was to the left of target) insert AFTER the
  // target so that dropping on tab N places the dragged tab at N+1, not N-1.
  // When dragging leftward insert BEFORE the target (existing behaviour).
  const insertAt = draggedIndex < targetIndex ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  next.splice(insertAt, 0, draggedTabId);
  return {
    ...state,
    group: { ...state.group, tabIds: next },
  };
}

export function setCustomTitle(
  state: UiTabsState,
  tabId: string,
  customTitle: string | null,
): UiTabsState {
  const tab = state.tabsById[tabId];
  if (!tab) {
    return state;
  }
  const trimmed = customTitle === null ? null : customTitle.trim();
  const next: Tab = {
    ...tab,
    customTitle: trimmed && trimmed.length > 0 ? trimmed : null,
    titleLocked: trimmed !== null && trimmed.length > 0,
  };
  if (next.customTitle === tab.customTitle && next.titleLocked === tab.titleLocked) {
    return state;
  }
  return {
    ...state,
    tabsById: { ...state.tabsById, [tabId]: next },
  };
}

export interface MergeTabsResult {
  state: UiTabsState;
  ok: boolean;
}

export function mergeTabs(
  state: UiTabsState,
  leftTabId: string,
  rightTabId: string,
): MergeTabsResult {
  if (leftTabId === rightTabId) {
    return { state, ok: false };
  }
  if (!state.tabsById[leftTabId] || !state.tabsById[rightTabId]) {
    return { state, ok: false };
  }
  if (
    isMergedTabId(state.group.mergedPairs, leftTabId) ||
    isMergedTabId(state.group.mergedPairs, rightTabId)
  ) {
    return { state, ok: false };
  }
  if (state.group.mergedPairs.length >= MAX_MERGED_PAIRS) {
    return { state, ok: false };
  }
  const pair: MergedTabPair = {
    leftTabId,
    rightTabId,
    splitRatio: DEFAULT_SPLIT_RATIO,
  };
  return {
    ok: true,
    state: {
      ...state,
      group: {
        ...state.group,
        mergedPairs: [...state.group.mergedPairs, pair],
      },
    },
  };
}

export function splitMergedTabs(state: UiTabsState, tabId: string): UiTabsState {
  const index = findPairIndexContaining(state.group.mergedPairs, tabId);
  if (index < 0) {
    return state;
  }
  const nextPairs = state.group.mergedPairs.filter((_, i) => i !== index);
  return {
    ...state,
    group: { ...state.group, mergedPairs: nextPairs },
  };
}

export function setSplitRatio(
  state: UiTabsState,
  leftTabId: string,
  rightTabId: string,
  ratio: number,
): UiTabsState {
  const next = clampSplitRatio(ratio);
  let changed = false;
  const nextPairs = state.group.mergedPairs.map((pair) => {
    if (pair.leftTabId === leftTabId && pair.rightTabId === rightTabId) {
      if (pair.splitRatio === next) {
        return pair;
      }
      changed = true;
      return { ...pair, splitRatio: next };
    }
    return pair;
  });
  if (!changed) {
    return state;
  }
  return {
    ...state,
    group: { ...state.group, mergedPairs: nextPairs },
  };
}

export function setTabDiffOpen(state: UiTabsState, tabId: string, open: boolean): UiTabsState {
  const tab = state.tabsById[tabId];
  if (!tab) {
    return state;
  }
  if (tab.diffOpen === open) {
    return state;
  }
  return {
    ...state,
    tabsById: { ...state.tabsById, [tabId]: { ...tab, diffOpen: open } },
  };
}

export function closeTabsByThreadIds(
  state: UiTabsState,
  environmentId: EnvironmentId,
  threadIds: readonly ThreadId[],
): UiTabsState {
  if (threadIds.length === 0) {
    return state;
  }
  const targetSet = new Set(threadIds);
  const tabIdsToClose: string[] = [];
  for (const tabId of state.group.tabIds) {
    const tab = state.tabsById[tabId];
    if (!tab) {
      continue;
    }
    if (
      tab.target.kind === "server" &&
      tab.target.threadRef.environmentId === environmentId &&
      targetSet.has(tab.target.threadRef.threadId)
    ) {
      tabIdsToClose.push(tabId);
    }
  }
  if (tabIdsToClose.length === 0) {
    return state;
  }
  let next = state;
  for (const tabId of tabIdsToClose) {
    next = closeTab(next, tabId);
  }
  return next;
}

export function promoteDraftTab(
  state: UiTabsState,
  draftId: DraftId,
  threadRef: ScopedThreadRef,
): UiTabsState {
  const draftTabIds = state.group.tabIds.filter((tabId) => {
    const tab = state.tabsById[tabId];
    return tab?.target.kind === "draft" && tab.target.draftId === draftId;
  });
  if (draftTabIds.length === 0) {
    return state;
  }

  const draftTabIdSet = new Set(draftTabIds);
  const existingServerTabId = state.group.tabIds.find((tabId) => {
    if (draftTabIdSet.has(tabId)) {
      return false;
    }
    const tab = state.tabsById[tabId];
    return !!tab && targetMatchesThread(tab.target, threadRef);
  });

  // When URL sync already created the canonical server tab, avoid ending up
  // with duplicated tabs that point at the same server thread.
  if (existingServerTabId) {
    let next = state;
    for (const tabId of draftTabIds) {
      next = closeTab(next, tabId);
    }
    const removedActive = draftTabIds.includes(state.group.activeTabId ?? "");
    const removedFocused = draftTabIds.includes(state.group.focusedTabId ?? "");
    if (!removedActive && !removedFocused) {
      return next;
    }
    return {
      ...next,
      group: {
        ...next.group,
        activeTabId: removedActive ? existingServerTabId : next.group.activeTabId,
        focusedTabId: removedFocused ? existingServerTabId : next.group.focusedTabId,
      },
    };
  }

  const nextTabsById: Record<string, Tab> = {};
  for (const [tabId, tab] of Object.entries(state.tabsById)) {
    if (tab.target.kind === "draft" && tab.target.draftId === draftId) {
      nextTabsById[tabId] = {
        ...tab,
        target: { kind: "server", threadRef },
      };
      continue;
    }
    nextTabsById[tabId] = tab;
  }
  return { ...state, tabsById: nextTabsById };
}

/**
 * 格式化标签状态快照，用于日志输出。
 * 提供标签总数、每个标签的 ID 和目标类型、激活状态等关键信息。
 */
export function formatTabsSnapshot(state: UiTabsState): Record<string, unknown> {
  return {
    标签总数: state.group.tabIds.length,
    标签列表: state.group.tabIds.map((id) => {
      const tab = state.tabsById[id];
      if (!tab) return { id, 状态: "数据异常(不存在)" };
      const targetDesc =
        tab.target.kind === "server"
          ? `会话(${tab.target.threadRef.environmentId}/${tab.target.threadRef.threadId})`
          : `草稿(${tab.target.draftId})`;
      return {
        id,
        目标: targetDesc,
        自定义标题: tab.customTitle ?? "(自动)",
        标题锁定: tab.titleLocked,
      };
    }),
    激活标签ID: state.group.activeTabId ?? "(无)",
    聚焦标签ID: state.group.focusedTabId ?? "(无)",
    分屏对数: state.group.mergedPairs.length,
  };
}

function isValidTabTarget(target: unknown): target is TabTarget {
  if (target === null || typeof target !== "object") {
    return false;
  }
  const candidate = target as { kind?: unknown };
  if (candidate.kind === "server") {
    const threadRef = (candidate as { threadRef?: unknown }).threadRef;
    if (!threadRef || typeof threadRef !== "object") {
      return false;
    }
    const ref = threadRef as { environmentId?: unknown; threadId?: unknown };
    return typeof ref.environmentId === "string" && typeof ref.threadId === "string";
  }
  if (candidate.kind === "draft") {
    return typeof (candidate as { draftId?: unknown }).draftId === "string";
  }
  return false;
}

function isValidTab(tab: unknown): tab is Tab {
  if (tab === null || typeof tab !== "object") {
    return false;
  }
  const candidate = tab as Tab;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    isValidTabTarget(candidate.target) &&
    (candidate.customTitle === null || typeof candidate.customTitle === "string") &&
    typeof candidate.titleLocked === "boolean" &&
    typeof candidate.diffOpen === "boolean"
  );
}

function isValidMergedPair(pair: unknown, tabIdSet: ReadonlySet<string>): pair is MergedTabPair {
  if (pair === null || typeof pair !== "object") {
    return false;
  }
  const candidate = pair as MergedTabPair;
  return (
    typeof candidate.leftTabId === "string" &&
    typeof candidate.rightTabId === "string" &&
    candidate.leftTabId !== candidate.rightTabId &&
    tabIdSet.has(candidate.leftTabId) &&
    tabIdSet.has(candidate.rightTabId) &&
    typeof candidate.splitRatio === "number" &&
    Number.isFinite(candidate.splitRatio)
  );
}

function hydrateTabsByIdMap(input: unknown): Record<string, Tab> | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const result: Record<string, Tab> = {};
  for (const [tabId, tab] of Object.entries(input as Record<string, unknown>)) {
    if (!isValidTab(tab) || tab.id !== tabId) {
      return null;
    }
    result[tabId] = {
      id: tab.id,
      target: tab.target,
      customTitle: tab.customTitle,
      titleLocked: tab.titleLocked,
      diffOpen: tab.diffOpen,
    };
  }
  return result;
}

function hydrateOrderedTabIds(
  rawTabIds: unknown,
  validTabsById: Record<string, Tab>,
): { tabIds: string[]; tabIdSet: Set<string> } | null {
  if (!Array.isArray(rawTabIds) || rawTabIds.length > MAX_TABS) {
    return null;
  }
  const tabIdSet = new Set<string>();
  const tabIds: string[] = [];
  for (const tabId of rawTabIds) {
    if (typeof tabId !== "string" || !validTabsById[tabId] || tabIdSet.has(tabId)) {
      return null;
    }
    tabIdSet.add(tabId);
    tabIds.push(tabId);
  }
  return { tabIds, tabIdSet };
}

function hydrateMergedPairs(
  rawPairs: unknown,
  tabIdSet: ReadonlySet<string>,
): MergedTabPair[] | null {
  if (!Array.isArray(rawPairs) || rawPairs.length > MAX_MERGED_PAIRS) {
    return null;
  }
  const mergedTabIds = new Set<string>();
  const sanitizedPairs: MergedTabPair[] = [];
  for (const pair of rawPairs) {
    if (
      !isValidMergedPair(pair, tabIdSet) ||
      mergedTabIds.has(pair.leftTabId) ||
      mergedTabIds.has(pair.rightTabId)
    ) {
      return null;
    }
    mergedTabIds.add(pair.leftTabId);
    mergedTabIds.add(pair.rightTabId);
    sanitizedPairs.push({
      leftTabId: pair.leftTabId,
      rightTabId: pair.rightTabId,
      splitRatio: clampSplitRatio(pair.splitRatio),
    });
  }
  return sanitizedPairs;
}

function isValidActiveOrFocusedTabId(candidate: unknown, tabIdSet: ReadonlySet<string>): boolean {
  if (candidate === null || candidate === undefined) {
    return true;
  }
  return typeof candidate === "string" && tabIdSet.has(candidate);
}

/**
 * Validates persisted tabs. Returns null when any constraint is violated; the
 * caller should fall back to seed initialization rather than partially trusting
 * a corrupt blob.
 */
export function hydrateTabsState(persisted: unknown): UiTabsState | null {
  if (persisted === null || typeof persisted !== "object") {
    console.log("【标签加载】hydrateTabsState: 持久化数据为 null 或非对象类型，校验失败");
    return null;
  }
  const candidate = persisted as PersistedTabsState;
  if (candidate.version !== TABS_PERSISTED_VERSION) {
    console.log("【标签加载】hydrateTabsState: 版本不匹配，校验失败", {
      当前版本: TABS_PERSISTED_VERSION,
      持久化版本: candidate.version,
    });
    return null;
  }
  if (!candidate.group || typeof candidate.group !== "object") {
    console.log("【标签加载】hydrateTabsState: group 字段无效，校验失败");
    return null;
  }

  const validTabsById = hydrateTabsByIdMap(candidate.tabsById);
  if (!validTabsById) {
    console.log("【标签加载】hydrateTabsState: tabsById 水合失败，校验失败", {
      "tabsById 类型": typeof candidate.tabsById,
      "tabsById 内容示例": candidate.tabsById
        ? Object.keys(candidate.tabsById).slice(0, 3)
        : undefined,
    });
    return null;
  }

  const orderedTabIds = hydrateOrderedTabIds(candidate.group.tabIds, validTabsById);
  if (!orderedTabIds) {
    console.log("【标签加载】hydrateTabsState: tabIds 有序列表水合失败，校验失败", {
      "tabIds 类型": typeof candidate.group.tabIds,
      是否为数组: Array.isArray(candidate.group.tabIds),
      "tabIds 长度": Array.isArray(candidate.group.tabIds)
        ? candidate.group.tabIds.length
        : undefined,
    });
    return null;
  }
  const { tabIds, tabIdSet } = orderedTabIds;

  if (
    !isValidActiveOrFocusedTabId(candidate.group.activeTabId, tabIdSet) ||
    !isValidActiveOrFocusedTabId(candidate.group.focusedTabId, tabIdSet)
  ) {
    console.log("【标签加载】hydrateTabsState: activeTabId 或 focusedTabId 无效，校验失败", {
      activeTabId: candidate.group.activeTabId,
      focusedTabId: candidate.group.focusedTabId,
      "有效标签 ID 集合": Array.from(tabIdSet),
    });
    return null;
  }

  const sanitizedPairs = hydrateMergedPairs(candidate.group.mergedPairs, tabIdSet);
  if (!sanitizedPairs) {
    console.log("【标签加载】hydrateTabsState: mergedPairs 水合失败，校验失败", {
      "mergedPairs 类型": typeof candidate.group.mergedPairs,
      "mergedPairs 长度": Array.isArray(candidate.group.mergedPairs)
        ? candidate.group.mergedPairs.length
        : undefined,
    });
    return null;
  }

  const finalTabsById: Record<string, Tab> = {};
  for (const tabId of tabIds) {
    finalTabsById[tabId] = validTabsById[tabId]!;
  }

  console.log("【标签加载】hydrateTabsState: 水合成功", {
    最终标签数量: tabIds.length,
    "标签 ID 列表": tabIds,
    "激活标签 ID": candidate.group.activeTabId ?? null,
    聚合对数量: sanitizedPairs.length,
  });

  return {
    tabsById: finalTabsById,
    group: {
      id: typeof candidate.group.id === "string" ? candidate.group.id : DEFAULT_TAB_GROUP_ID,
      tabIds,
      activeTabId: candidate.group.activeTabId ?? null,
      focusedTabId: candidate.group.focusedTabId ?? null,
      mergedPairs: sanitizedPairs,
    },
  };
}

export function persistTabsState(state: UiTabsState): PersistedTabsState {
  return {
    version: TABS_PERSISTED_VERSION,
    tabsById: state.tabsById,
    group: state.group,
  };
}

/**
 * Returns the scoped thread key for a server-target tab, or null otherwise.
 */
export function tabServerThreadKey(tab: Tab): string | null {
  return tab.target.kind === "server" ? scopedThreadKey(tab.target.threadRef) : null;
}
