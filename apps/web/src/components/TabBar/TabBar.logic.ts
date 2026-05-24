import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime";
import type { DraftId } from "../../draftId";
import {
  findTabByDraft,
  findTabByFile,
  findTabByThread,
  MAX_MERGED_PAIRS,
  MAX_TABS,
  type MergedTabPair,
  type Tab,
  type TabTarget,
  type UiTabsState,
} from "../../uiTabsState";

const DRAFT_TITLE_PREFIX = "草稿 · ";
const DRAFT_FALLBACK_TITLE = "未命名";
const SERVER_FALLBACK_TITLE = "新会话";
const DRAFT_PROMPT_TITLE_MAX_LENGTH = 50;

export interface TabTitleInputs {
  tab: Tab;
  /** Server thread title when `tab.target.kind === "server"`. */
  serverThreadTitle?: string | null | undefined;
  /** Active composer prompt when `tab.target.kind === "draft"`. */
  draftPrompt?: string | undefined;
  /** Optional project short name to prepend when crossing projects. */
  projectShortName?: string | undefined;
}

/**
 * Resolve the visible title for a tab.
 *
 * Title precedence:
 * 1. `tab.customTitle` when `titleLocked` (user explicitly named the tab)
 * 2. server thread → `serverThreadTitle || SERVER_FALLBACK_TITLE`
 * 3. draft → `"草稿 · " + (first non-empty line truncated to 50 chars || DRAFT_FALLBACK_TITLE)`
 *
 * If `projectShortName` is provided, it's prepended as `"<short>: <title>"` so
 * cross-project tabs are distinguishable in a busy bar.
 */
export function resolveTabTitle(inputs: TabTitleInputs): string {
  const { tab, serverThreadTitle, draftPrompt, projectShortName } = inputs;
  const base = computeBaseTitle(tab, serverThreadTitle, draftPrompt);
  if (tab.titleLocked && tab.customTitle && tab.customTitle.trim().length > 0) {
    return prependProjectShort(tab.customTitle.trim(), projectShortName);
  }
  return prependProjectShort(base, projectShortName);
}

function computeBaseTitle(
  tab: Tab,
  serverThreadTitle: string | null | undefined,
  draftPrompt: string | undefined,
): string {
  if (tab.target.kind === "file") {
    return tab.target.fileName;
  }
  if (tab.target.kind === "server") {
    const trimmed = serverThreadTitle?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : SERVER_FALLBACK_TITLE;
  }
  return `${DRAFT_TITLE_PREFIX}${truncateDraftPrompt(draftPrompt)}`;
}

function truncateDraftPrompt(prompt: string | undefined): string {
  if (!prompt) {
    return DRAFT_FALLBACK_TITLE;
  }
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) {
    return DRAFT_FALLBACK_TITLE;
  }
  const trimmed = firstLine.trim();
  return trimmed.length > DRAFT_PROMPT_TITLE_MAX_LENGTH
    ? `${trimmed.slice(0, DRAFT_PROMPT_TITLE_MAX_LENGTH)}…`
    : trimmed;
}

function prependProjectShort(title: string, short: string | undefined): string {
  if (!short || short.trim().length === 0) {
    return title;
  }
  return `${short.trim()}: ${title}`;
}

/**
 * Generate a unique tab id. Prefers `crypto.randomUUID()` (modern browsers and
 * Node 19+); falls back to a random base-36 string when unavailable so unit
 * tests don't depend on a real `crypto` global.
 */
export function nextTabId(): string {
  const cryptoCandidate = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoCandidate?.randomUUID) {
    return `tab-${cryptoCandidate.randomUUID()}`;
  }
  const random = Math.floor(Math.random() * 1e12).toString(36);
  return `tab-${Date.now().toString(36)}-${random}`;
}

export type TabActivationDecision =
  | { action: "activate-existing"; tabId: string; alreadyActive: boolean }
  | { action: "create" }
  | { action: "exceeds-limit"; suggestedReplacementTabId: string | null };

/**
 * Compute what should happen when navigating to `target`. Caller passes the
 * current `state` plus an optional `threadLastVisitedAtById` map (used to find
 * a sensible "least-recently-visited" replacement when at the cap).
 *
 * Returns one of:
 * - `activate-existing`: a tab already targets the same thread/draft → just
 *   activate it (and report whether it was already active so caller can skip
 *   redundant URL writes)
 * - `create`: under the 6-tab cap → caller can call `createTab` directly
 * - `exceeds-limit`: at cap → caller should show a toast offering "替换当前" or
 *   "替换最久未访问". `suggestedReplacementTabId` is the LRU candidate (or null
 *   when every tab is the active one — only happens with cap=1)
 */
export function decideTabActivation(
  state: UiTabsState,
  target: TabTarget,
  threadLastVisitedAtById?: Record<string, string>,
): TabActivationDecision {
  const existing = findExistingTab(state, target);
  if (existing) {
    return {
      action: "activate-existing",
      tabId: existing.id,
      alreadyActive: state.group.activeTabId === existing.id,
    };
  }
  // 文件标签不占会话标签上限
  if (target.kind === "file" || state.group.tabIds.length < MAX_TABS) {
    return { action: "create" };
  }
  return {
    action: "exceeds-limit",
    suggestedReplacementTabId: pickLeastRecentlyVisitedTabId(state, threadLastVisitedAtById ?? {}),
  };
}

function findExistingTab(state: UiTabsState, target: TabTarget): Tab | undefined {
  if (target.kind === "server") {
    return findTabByThread(state, target.threadRef);
  }
  if (target.kind === "draft") {
    return findTabByDraft(state, target.draftId);
  }
  return findTabByFile(state, target.filePath);
}

/**
 * Picks the tab whose target was visited least recently, excluding the active
 * tab. Useful as a default replacement when at the 6-tab cap.
 *
 * For server tabs, "visited at" is read from `threadLastVisitedAtById` keyed by
 * the scoped thread key. Draft tabs without a visited-at entry are treated as
 * older than any server tab with one (drafts are "least loved" by default).
 */
export function pickLeastRecentlyVisitedTabId(
  state: UiTabsState,
  threadLastVisitedAtById: Record<string, string>,
): string | null {
  let oldestId: string | null = null;
  let oldestVisitedAt: string | null = null;
  for (const tabId of state.group.tabIds) {
    if (tabId === state.group.activeTabId) {
      continue;
    }
    const tab = state.tabsById[tabId];
    if (!tab) {
      continue;
    }
    // 文件标签不参与 LRU 淘汰
    if (tab.target.kind === "file") {
      continue;
    }
    const visitedAt = readVisitedAtForTab(tab, threadLastVisitedAtById);
    if (oldestId === null || compareVisitedAt(visitedAt, oldestVisitedAt) < 0) {
      oldestId = tabId;
      oldestVisitedAt = visitedAt;
    }
  }
  return oldestId;
}

function readVisitedAtForTab(
  tab: Tab,
  threadLastVisitedAtById: Record<string, string>,
): string | null {
  if (tab.target.kind !== "server") {
    return null;
  }
  return threadLastVisitedAtById[scopedThreadKey(tab.target.threadRef)] ?? null;
}

function compareVisitedAt(a: string | null, b: string | null): number {
  if (a === b) return 0;
  // null is treated as oldest (sortable to the front)
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/**
 * Return the next tab to focus after `removedTabId` is closed. Mirrors the
 * fallback rules embedded in `closeTab` so that UI components (e.g. focus
 * restoration after keyboard close) can preview the outcome.
 */
export function pickNextActiveTabAfterClose(
  state: UiTabsState,
  removedTabId: string,
): string | null {
  const removedIndex = state.group.tabIds.indexOf(removedTabId);
  if (removedIndex < 0) {
    return state.group.activeTabId;
  }
  const remaining = state.group.tabIds.filter((id) => id !== removedTabId);
  if (remaining.length === 0) {
    return null;
  }
  if (state.group.activeTabId !== removedTabId) {
    return state.group.activeTabId;
  }
  return remaining[removedIndex] ?? remaining.at(-1) ?? null;
}

/**
 * Stable string key for a TabTarget, useful for `useMemo` / equality comparison
 * across renders.
 */
export function tabTargetKey(target: TabTarget): string {
  if (target.kind === "server") {
    return `server:${scopedThreadKey(target.threadRef)}`;
  }
  if (target.kind === "draft") {
    return `draft:${target.draftId}`;
  }
  return `file:${target.filePath}`;
}

export function tabTargetToServer(target: TabTarget): ScopedThreadRef | null {
  return target.kind === "server" ? target.threadRef : null;
}

export function tabTargetToDraft(target: TabTarget): DraftId | null {
  return target.kind === "draft" ? target.draftId : null;
}

export function tabTargetToFile(target: TabTarget): { filePath: string; workspaceRoot: string; environmentId: string; fileName: string } | null {
  return target.kind === "file" ? { filePath: target.filePath, workspaceRoot: target.workspaceRoot, environmentId: target.environmentId, fileName: target.fileName } : null;
}

/**
 * One renderable item in the TabBar: either a stand-alone tab or a merged
 * pair. The bar emits one DOM node per item; merged pairs claim the position
 * of their `leftTab` so the visual order matches `tabIds`.
 */
export type TabBarItemGroup =
  | { kind: "single"; tab: Tab }
  | { kind: "merged"; pair: MergedTabPair; leftTab: Tab; rightTab: Tab };

/**
 * Project an ordered tab list + the merged-pair set into the visible items the
 * TabBar should render. Right-side members of a merged pair are folded into
 * their pair's slot so they don't appear twice.
 *
 * Inconsistent pair entries (e.g. a `leftTabId` that no longer exists in
 * `tabsById`) are skipped silently — `closeTab` already prunes pairs when
 * either side is removed, so this is a defensive check for persistence
 * corruption.
 */
export function buildTabBarItemGroups(
  orderedTabs: readonly Tab[],
  mergedPairs: readonly MergedTabPair[],
): TabBarItemGroup[] {
  const tabsById = new Map<string, Tab>(orderedTabs.map((tab) => [tab.id, tab]));
  const consumed = new Set<string>();
  const out: TabBarItemGroup[] = [];
  for (const tab of orderedTabs) {
    if (consumed.has(tab.id)) continue;
    const pair = mergedPairs.find(
      (candidate) => candidate.leftTabId === tab.id || candidate.rightTabId === tab.id,
    );
    if (pair) {
      const leftTab = tabsById.get(pair.leftTabId);
      const rightTab = tabsById.get(pair.rightTabId);
      if (leftTab && rightTab) {
        out.push({ kind: "merged", pair, leftTab, rightTab });
        consumed.add(leftTab.id);
        consumed.add(rightTab.id);
        continue;
      }
    }
    out.push({ kind: "single", tab });
    consumed.add(tab.id);
  }
  return out;
}

export interface MergeNeighborCandidate {
  /** Left side of the candidate merge (sits earlier in `tabIds`). */
  leftTabId: string;
  /** Right side of the candidate merge. */
  rightTabId: string;
}

/**
 * Find the right-most adjacent pair of stand-alone tabs that the user could
 * merge with one click of the "merge" toolbar button. Returns `null` when no
 * such pair exists (every tab is already merged, the cap is reached, or there
 * are fewer than two stand-alone tabs).
 *
 * "Adjacent" is required because the design merges only neighbouring tabs;
 * arbitrary merges are reserved for the right-click "与右侧合并" command.
 */
export function pickAutoMergeCandidate(state: UiTabsState): MergeNeighborCandidate | null {
  if (state.group.mergedPairs.length >= MAX_MERGED_PAIRS) return null;
  const isMerged = (tabId: string): boolean =>
    state.group.mergedPairs.some((pair) => pair.leftTabId === tabId || pair.rightTabId === tabId);
  const tabIds = state.group.tabIds;
  for (let i = tabIds.length - 1; i > 0; i--) {
    const right = tabIds[i];
    const left = tabIds[i - 1];
    if (!right || !left) continue;
    const rightTab = state.tabsById[right];
    const leftTab = state.tabsById[left];
    // 文件标签不参与合并
    if (!rightTab || !leftTab || rightTab.target.kind === "file" || leftTab.target.kind === "file") continue;
    if (isMerged(right) || isMerged(left)) continue;
    return { leftTabId: left, rightTabId: right };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Context-menu vocabulary
// ──────────────────────────────────────────────────────────────────────────────
//
// Both single-tab and merged-pair right-click menus are computed by these
// helpers so the live UI and unit tests stay in lockstep. The action ids
// double as a versioned protocol between TabBar and its parent (TabbedShell):
// the parent only has to switch on the action and call the relevant store
// reducer, no per-menu callback explosions.

export type TabSingleMenuAction =
  | "rename"
  | "reset-title"
  | "close"
  | "close-others"
  | "close-to-right"
  | "merge-with-right"
  | "split"; // only present when the tab is currently in a merged pair

export type TabMergedMenuAction =
  | "split"
  | "rename-left"
  | "reset-title-left"
  | "rename-right"
  | "reset-title-right"
  | "close-left"
  | "close-right"
  | "close-pair"
  | "close-others";

export interface MenuEntry<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly disabled?: boolean;
}

interface SingleMenuArgs {
  tab: Tab;
  /** Ordered tab ids in the active group (must match tab id order). */
  orderedTabIds: readonly string[];
  /** Currently merged pairs. */
  mergedPairs: readonly MergedTabPair[];
  /** Visible title for the current tab — used in entries that quote it. */
  tabTitle: string;
}

/**
 * Build the right-click menu for a stand-alone tab. Entries are filtered by
 * eligibility (e.g. "merge with right" hides when there is no right neighbour
 * or when the merged-pair cap is reached). Returning a tagged array keeps
 * caller code linear: it can do `await contextMenu.show(entries, ...)` then
 * dispatch on the returned id.
 */
export function buildSingleTabMenuEntries(
  args: SingleMenuArgs,
): readonly MenuEntry<TabSingleMenuAction>[] {
  const { tab, orderedTabIds, mergedPairs, tabTitle } = args;

  // 文件标签右键菜单精简：仅保留"关闭"
  if (tab.target.kind === "file") {
    return [{ id: "close", label: "关闭标签" }];
  }

  const tabIndex = orderedTabIds.indexOf(tab.id);
  const isInPair = mergedPairs.some(
    (pair) => pair.leftTabId === tab.id || pair.rightTabId === tab.id,
  );
  const rightNeighborId = tabIndex >= 0 ? orderedTabIds[tabIndex + 1] : undefined;
  const rightNeighborInPair = rightNeighborId
    ? mergedPairs.some(
        (pair) => pair.leftTabId === rightNeighborId || pair.rightTabId === rightNeighborId,
      )
    : false;
  const hasOthers = orderedTabIds.length > 1;
  const tabsToTheRight = tabIndex >= 0 ? orderedTabIds.length - tabIndex - 1 : 0;
  const canMergeWithRight =
    !isInPair &&
    rightNeighborId !== undefined &&
    !rightNeighborInPair &&
    mergedPairs.length < MAX_MERGED_PAIRS;

  const entries: MenuEntry<TabSingleMenuAction>[] = [
    { id: "rename", label: `重命名（${tabTitle}）` },
  ];
  if (tab.titleLocked) {
    entries.push({ id: "reset-title", label: "恢复自动标题" });
  }
  entries.push(
    { id: "close", label: "关闭标签" },
    { id: "close-others", label: "关闭其他", disabled: !hasOthers },
    {
      id: "close-to-right",
      label: "关闭右侧",
      disabled: tabsToTheRight === 0,
    },
  );
  if (isInPair) {
    entries.push({ id: "split", label: "从合并中分离" });
  } else {
    entries.push({
      id: "merge-with-right",
      label: "与右侧合并",
      disabled: !canMergeWithRight,
    });
  }
  return entries;
}

interface MergedMenuArgs {
  pair: MergedTabPair;
  leftTab: Tab;
  rightTab: Tab;
  leftTitle: string;
  rightTitle: string;
  orderedTabIds: readonly string[];
}

/**
 * Build the right-click menu for a merged pair slot. Each entry references
 * the left or right member explicitly so the caller can dispatch the matching
 * close/rename action without having to re-resolve which side the user
 * clicked on.
 */
export function buildMergedTabMenuEntries(
  args: MergedMenuArgs,
): readonly MenuEntry<TabMergedMenuAction>[] {
  const { leftTitle, rightTitle, orderedTabIds, pair } = args;
  const occupiedByPair = new Set([pair.leftTabId, pair.rightTabId]);
  const hasOthers = orderedTabIds.some((id) => !occupiedByPair.has(id));

  return [
    { id: "split", label: "分离合并" },
    { id: "rename-left", label: `重命名左侧（${leftTitle}）` },
    { id: "rename-right", label: `重命名右侧（${rightTitle}）` },
    { id: "close-left", label: `关闭左侧（${leftTitle}）` },
    { id: "close-right", label: `关闭右侧（${rightTitle}）` },
    { id: "close-pair", label: "关闭整组" },
    { id: "close-others", label: "关闭其他", disabled: !hasOthers },
  ];
}
