import { Debouncer } from "@tanstack/react-pacer";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

import { decideTabActivation } from "./components/TabBar/TabBar.logic";
import { showTabsAtCapBlockedToast } from "./components/TabBar/tabsAtCapToast";
import type { DraftId } from "./draftId";
import {
  activateTab as activateTabReducer,
  closeTab as closeTabReducer,
  closeTabs as closeTabsReducer,
  closeTabsByThreadIds as closeTabsByThreadIdsReducer,
  createTab as createTabReducer,
  formatTabsSnapshot,
  hydrateTabsState,
  initialTabsState,
  mergeTabs as mergeTabsReducer,
  persistTabsState,
  pruneOrphanedServerTabs as pruneOrphanedServerTabsReducer,
  promoteDraftTab as promoteDraftTabReducer,
  reorderTabs as reorderTabsReducer,
  setCustomTitle as setCustomTitleReducer,
  setFocusedTab as setFocusedTabReducer,
  setSplitRatio as setSplitRatioReducer,
  setTabDiffOpen as setTabDiffOpenReducer,
  splitMergedTabs as splitMergedTabsReducer,
  type CreateTabOptions,
  type PersistedTabsState,
  type TabTarget,
  type UiTabsState,
} from "./uiTabsState";

export const PERSISTED_STATE_KEY = "t3code:ui-state:v1";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v8",
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

export interface PersistedUiState {
  collapsedProjectCwds?: string[];
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  threadChangedFilesExpandedById?: Record<string, Record<string, boolean>>;
  tabs?: PersistedTabsState;
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: string[];
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  threadChangedFilesExpandedById: Record<string, Record<string, boolean>>;
}

export interface UiTabsRootState {
  tabs: UiTabsState;
}

export interface UiState extends UiProjectState, UiThreadState, UiTabsRootState {}

export interface SyncProjectInput {
  /** Physical project key (env + cwd). Used for manual sort order. */
  key: string;
  /** Logical group key. Used for expand/collapse state. */
  logicalKey: string;
  cwd: string;
}

export interface SyncThreadInput {
  key: string;
  seedVisitedAt?: string | undefined;
}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  threadLastVisitedAtById: {},
  threadChangedFilesExpandedById: {},
  tabs: initialTabsState,
};

const persistedCollapsedProjectCwds = new Set<string>();
const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];
// Pre-fix persisted shape only listed expanded cwds, so anything not listed
// was treated as collapsed. Track whether the loaded blob carried the new
// `collapsedProjectCwds` field so we can preserve that legacy semantic for
// one session after upgrade, until persistState rewrites in the new shape.
let persistedProjectStateUsesLegacyShape = false;
const currentProjectCwdById = new Map<string, string>();
const currentProjectCwdsByLogicalKey = new Map<string, string[]>();
const currentLogicalKeyByPhysicalKey = new Map<string, string>();
let legacyKeysCleanedUp = false;

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = globalThis.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      console.log("【标签加载】localStorage 中未找到持久化数据");
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = globalThis.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        console.log("【标签加载】从旧版键名加载数据:", legacyKey);
        hydratePersistedProjectState(JSON.parse(legacyRaw) as PersistedUiState);
        return initialState;
      }
      console.log("【标签加载】未找到任何持久化数据，使用初始空状态");
      console.log(
        "%c【标签启动】无持久化数据，初始为空",
        "background:#6366f1;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
        formatTabsSnapshot(initialTabsState),
      );
      return initialState;
    }
    const parsed = JSON.parse(raw) as PersistedUiState;
    const hydratedTabs = hydrateTabsState(parsed.tabs);
    console.log("【标签加载】从 localStorage 读取持久化数据:", {
      原始标签数据存在: !!parsed.tabs,
      标签版本: parsed.tabs?.version,
      标签数量: parsed.tabs?.group?.tabIds?.length ?? 0,
      标签ID列表: parsed.tabs?.group?.tabIds,
      激活的标签ID: parsed.tabs?.group?.activeTabId,
      水合成功: !!hydratedTabs,
      水合后标签数量: hydratedTabs?.group?.tabIds?.length ?? 0,
    });
    hydratePersistedProjectState(parsed);

    const finalTabs = hydratedTabs ?? initialTabsState;
    console.log(
      "%c【标签启动】标签状态初始化完成",
      "background:#6366f1;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      formatTabsSnapshot(finalTabs),
    );

    return {
      ...initialState,
      threadChangedFilesExpandedById: sanitizePersistedThreadChangedFilesExpanded(
        parsed.threadChangedFilesExpandedById,
      ),
      tabs: finalTabs,
    };
  } catch (error) {
    console.error("【标签加载】读取持久化数据时发生错误:", error);
    return initialState;
  }
}

function sanitizePersistedThreadChangedFilesExpanded(
  value: PersistedUiState["threadChangedFilesExpandedById"],
): Record<string, Record<string, boolean>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const nextState: Record<string, Record<string, boolean>> = {};
  for (const [threadId, turns] of Object.entries(value)) {
    if (!threadId || !turns || typeof turns !== "object") {
      continue;
    }

    const nextTurns: Record<string, boolean> = {};
    for (const [turnId, expanded] of Object.entries(turns)) {
      if (turnId && typeof expanded === "boolean" && expanded === false) {
        nextTurns[turnId] = false;
      }
    }

    if (Object.keys(nextTurns).length > 0) {
      nextState[threadId] = nextTurns;
    }
  }

  return nextState;
}

export function hydratePersistedProjectState(parsed: PersistedUiState): void {
  persistedCollapsedProjectCwds.clear();
  persistedExpandedProjectCwds.clear();
  persistedProjectOrderCwds.length = 0;
  persistedProjectStateUsesLegacyShape = !Array.isArray(parsed.collapsedProjectCwds);
  for (const cwd of parsed.collapsedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedCollapsedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.expandedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedExpandedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.projectOrderCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
      persistedProjectOrderCwds.push(cwd);
    }
  }
}

export function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    // Persist collapsed cwds explicitly so an empty/missing field unambiguously
    // means "first install" rather than "user collapsed everything"; without
    // this, the syncProjects fallback would re-expand all rows on next launch.
    const collapsedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => !expanded)
      .flatMap(([logicalKey]) => currentProjectCwdsByLogicalKey.get(logicalKey) ?? []);
    const expandedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([logicalKey]) => currentProjectCwdsByLogicalKey.get(logicalKey) ?? []);
    const projectOrderCwds = state.projectOrder.flatMap((projectId) => {
      const cwd = currentProjectCwdById.get(projectId);
      return cwd ? [cwd] : [];
    });
    const threadChangedFilesExpandedById = Object.fromEntries(
      Object.entries(state.threadChangedFilesExpandedById).flatMap(([threadId, turns]) => {
        const nextTurns = Object.fromEntries(
          Object.entries(turns).filter(([, expanded]) => expanded === false),
        );
        return Object.keys(nextTurns).length > 0 ? [[threadId, nextTurns]] : [];
      }),
    );
    const tabsToPersist = persistTabsState(state.tabs);
    console.log("【标签加载】正在持久化标签状态:", {
      标签版本: tabsToPersist.version,
      标签数量: tabsToPersist.group.tabIds.length,
      标签ID列表: tabsToPersist.group.tabIds,
      激活的标签ID: tabsToPersist.group.activeTabId,
      所有标签详情: tabsToPersist.group.tabIds.map((id) => ({
        id,
        目标类型: tabsToPersist.tabsById[id]?.target?.kind,
        线程ID:
          tabsToPersist.tabsById[id]?.target?.kind === "server"
            ? tabsToPersist.tabsById[id]?.target?.threadRef?.threadId
            : tabsToPersist.tabsById[id]?.target?.kind === "draft"
              ? tabsToPersist.tabsById[id]?.target?.draftId
              : undefined,
      })),
    });
    globalThis.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        collapsedProjectCwds,
        expandedProjectCwds,
        projectOrderCwds,
        threadChangedFilesExpandedById,
        tabs: tabsToPersist,
      } satisfies PersistedUiState),
    );
    // console.log("【标签加载】持久化成功，数据已写入 localStorage");
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        globalThis.localStorage.removeItem(legacyKey);
      }
    }
  } catch (error) {
    console.error("【标签加载】持久化标签状态时发生错误:", error);
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function projectOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  );
}

function nestedBooleanRecordsEqual(
  left: Record<string, Record<string, boolean>>,
  right: Record<string, Record<string, boolean>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (!(key in right) || !recordsEqual(value, right[key]!)) {
      return false;
    }
  }
  return true;
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const previousProjectCwdById = new Map(currentProjectCwdById);
  const previousLogicalKeyByPhysicalKey = new Map(currentLogicalKeyByPhysicalKey);
  currentProjectCwdById.clear();
  currentLogicalKeyByPhysicalKey.clear();
  for (const project of projects) {
    currentProjectCwdById.set(project.key, project.cwd);
    currentLogicalKeyByPhysicalKey.set(project.key, project.logicalKey);
  }
  currentProjectCwdsByLogicalKey.clear();
  for (const project of projects) {
    const cwds = currentProjectCwdsByLogicalKey.get(project.logicalKey);
    if (cwds) {
      if (!cwds.includes(project.cwd)) {
        cwds.push(project.cwd);
      }
    } else {
      currentProjectCwdsByLogicalKey.set(project.logicalKey, [project.cwd]);
    }
  }
  // Build reverse map: for each new logical key, which previous logical keys
  // did its member projects live under? Lets us preserve expand state when a
  // project's logical key changes (e.g. late-arriving repo metadata flips the
  // group identity).
  const previousLogicalKeysByNewLogicalKey = new Map<string, Set<string>>();
  for (const project of projects) {
    const previousLogicalKey = previousLogicalKeyByPhysicalKey.get(project.key);
    if (!previousLogicalKey || previousLogicalKey === project.logicalKey) {
      continue;
    }
    const set = previousLogicalKeysByNewLogicalKey.get(project.logicalKey);
    if (set) {
      set.add(previousLogicalKey);
    } else {
      previousLogicalKeysByNewLogicalKey.set(project.logicalKey, new Set([previousLogicalKey]));
    }
  }
  const cwdMappingChanged =
    previousProjectCwdById.size !== currentProjectCwdById.size ||
    projects.some((project) => previousProjectCwdById.get(project.key) !== project.cwd);

  const nextExpandedById: Record<string, boolean> = {};
  const previousExpandedById = state.projectExpandedById;
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const mappedProjects = projects.map((project, index) => {
    if (!(project.logicalKey in nextExpandedById)) {
      const groupCwds = currentProjectCwdsByLogicalKey.get(project.logicalKey) ?? [project.cwd];
      const fallbackFromPreviousLogicalKey = (() => {
        const previousKeys = previousLogicalKeysByNewLogicalKey.get(project.logicalKey);
        if (!previousKeys) {
          return undefined;
        }
        for (const previousKey of previousKeys) {
          if (previousKey in previousExpandedById) {
            return previousExpandedById[previousKey];
          }
        }
        return undefined;
      })();
      const fallbackFromPersistedShape = (() => {
        if (groupCwds.some((cwd) => persistedExpandedProjectCwds.has(cwd))) {
          return true;
        }
        if (groupCwds.some((cwd) => persistedCollapsedProjectCwds.has(cwd))) {
          return false;
        }
        if (persistedProjectStateUsesLegacyShape && persistedExpandedProjectCwds.size > 0) {
          return false;
        }
        return true;
      })();
      const expanded =
        previousExpandedById[project.logicalKey] ??
        fallbackFromPreviousLogicalKey ??
        fallbackFromPersistedShape;
      nextExpandedById[project.logicalKey] = expanded;
    }
    return {
      id: project.key,
      cwd: project.cwd,
      incomingIndex: index,
    };
  });

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? (() => {
          const currentProjectIds = new Set(mappedProjects.map((project) => project.id));
          const nextProjectIdByCwd = new Map(
            mappedProjects.map((project) => [project.cwd, project.id] as const),
          );
          const usedProjectIds = new Set<string>();
          const orderedProjectIds: string[] = [];

          for (const projectId of state.projectOrder) {
            const matchedProjectId =
              (currentProjectIds.has(projectId) ? projectId : undefined) ??
              (() => {
                const previousCwd = previousProjectCwdById.get(projectId);
                return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined;
              })();
            if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
              continue;
            }
            usedProjectIds.add(matchedProjectId);
            orderedProjectIds.push(matchedProjectId);
          }

          for (const project of mappedProjects) {
            if (usedProjectIds.has(project.id)) {
              continue;
            }
            orderedProjectIds.push(project.id);
          }

          return orderedProjectIds;
        })()
      : mappedProjects
          .map((project) => ({
            id: project.id,
            incomingIndex: project.incomingIndex,
            orderIndex:
              persistedOrderByCwd.get(project.cwd) ??
              persistedProjectOrderCwds.length + project.incomingIndex,
          }))
          .toSorted((left, right) => {
            const byOrder = left.orderIndex - right.orderIndex;
            if (byOrder !== 0) {
              return byOrder;
            }
            return left.incomingIndex - right.incomingIndex;
          })
          .map((project) => project.id);

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    !cwdMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
  };
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map((thread) => thread.key));
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId),
    ),
  );
  for (const thread of threads) {
    if (
      nextThreadLastVisitedAtById[thread.key] === undefined &&
      thread.seedVisitedAt !== undefined &&
      thread.seedVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.key] = thread.seedVisitedAt;
    }
  }
  const nextThreadChangedFilesExpandedById = Object.fromEntries(
    Object.entries(state.threadChangedFilesExpandedById).filter(([threadId]) =>
      retainedThreadIds.has(threadId),
    ),
  );
  if (
    recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById) &&
    nestedBooleanRecordsEqual(
      state.threadChangedFilesExpandedById,
      nextThreadChangedFilesExpandedById,
    )
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    threadChangedFilesExpandedById: nextThreadChangedFilesExpandedById,
  };
}

export function markThreadVisited(state: UiState, threadId: string, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: string,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function clearThreadUi(state: UiState, threadId: string): UiState {
  const hasVisitedState = threadId in state.threadLastVisitedAtById;
  const hasChangedFilesState = threadId in state.threadChangedFilesExpandedById;
  if (!hasVisitedState && !hasChangedFilesState) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  const nextThreadChangedFilesExpandedById = { ...state.threadChangedFilesExpandedById };
  delete nextThreadLastVisitedAtById[threadId];
  delete nextThreadChangedFilesExpandedById[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    threadChangedFilesExpandedById: nextThreadChangedFilesExpandedById,
  };
}

export function setThreadChangedFilesExpanded(
  state: UiState,
  threadId: string,
  turnId: string,
  expanded: boolean,
): UiState {
  const currentThreadState = state.threadChangedFilesExpandedById[threadId] ?? {};
  const currentExpanded = currentThreadState[turnId] ?? true;
  if (currentExpanded === expanded) {
    return state;
  }

  if (expanded) {
    if (!(turnId in currentThreadState)) {
      return state;
    }

    const nextThreadState = { ...currentThreadState };
    delete nextThreadState[turnId];
    if (Object.keys(nextThreadState).length === 0) {
      const nextState = { ...state.threadChangedFilesExpandedById };
      delete nextState[threadId];
      return {
        ...state,
        threadChangedFilesExpandedById: nextState,
      };
    }

    return {
      ...state,
      threadChangedFilesExpandedById: {
        ...state.threadChangedFilesExpandedById,
        [threadId]: nextThreadState,
      },
    };
  }

  return {
    ...state,
    threadChangedFilesExpandedById: {
      ...state.threadChangedFilesExpandedById,
      [threadId]: {
        ...currentThreadState,
        [turnId]: false,
      },
    },
  };
}

export function toggleProject(state: UiState, projectId: string): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true;
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  };
}

export function setProjectExpanded(state: UiState, projectId: string, expanded: boolean): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state;
  }
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  };
}

export function reorderProjects(
  state: UiState,
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): UiState {
  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = state.projectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...state.projectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  syncProjects: (projects: readonly SyncProjectInput[]) => void;
  syncThreads: (threads: readonly SyncThreadInput[]) => void;
  markThreadVisited: (threadId: string, visitedAt?: string) => void;
  markThreadUnread: (threadId: string, latestTurnCompletedAt: string | null | undefined) => void;
  clearThreadUi: (threadId: string) => void;
  setThreadChangedFilesExpanded: (threadId: string, turnId: string, expanded: boolean) => void;
  toggleProject: (projectId: string) => void;
  setProjectExpanded: (projectId: string, expanded: boolean) => void;
  reorderProjects: (
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
  ) => void;
  createTab: (target: TabTarget, options: CreateTabOptions) => void;
  closeTab: (tabId: string) => void;
  closeTabs: (tabIds: readonly string[]) => void;
  activateTab: (tabId: string) => void;
  setFocusedTab: (tabId: string) => void;
  reorderTabs: (draggedTabId: string, targetTabId: string) => void;
  setTabCustomTitle: (tabId: string, customTitle: string | null) => void;
  mergeTabs: (leftTabId: string, rightTabId: string) => boolean;
  splitMergedTabs: (tabId: string) => void;
  setTabSplitRatio: (leftTabId: string, rightTabId: string, ratio: number) => void;
  setTabDiffOpen: (tabId: string, open: boolean) => void;
  closeTabsByThreadIds: (environmentId: EnvironmentId, threadIds: readonly ThreadId[]) => void;
  pruneOrphanedServerTabs: (validThreadKeys: ReadonlySet<string>) => void;
  promoteDraftTab: (draftId: DraftId, threadRef: ScopedThreadRef) => void;
}

function updateTabs(state: UiState, updater: (tabs: UiTabsState) => UiTabsState): UiState {
  const nextTabs = updater(state.tabs);
  if (nextTabs === state.tabs) {
    return state;
  }
  return { ...state, tabs: nextTabs };
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  setThreadChangedFilesExpanded: (threadId, turnId, expanded) =>
    set((state) => setThreadChangedFilesExpanded(state, threadId, turnId, expanded)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectIds, targetProjectIds) =>
    set((state) => reorderProjects(state, draggedProjectIds, targetProjectIds)),

  // ── 标签操作（含状态日志） ──────────────────────────────────────────────

  createTab: (target, options) => {
    const state = useUiStateStore.getState();
    const activation = decideTabActivation(state.tabs, target, state.threadLastVisitedAtById);
    if (activation.action === "exceeds-limit") {
      showTabsAtCapBlockedToast();
      return;
    }
    const beforeCount = state.tabs.group.tabIds.length;
    set((s) => updateTabs(s, (tabs) => createTabReducer(tabs, target, options)));
    const tabs = useUiStateStore.getState().tabs;
    const created = beforeCount < tabs.group.tabIds.length;
    console.log(
      `%c【标签操作】${created ? "创建标签" : "标签已存在(跳过)"}`,
      "background:#22c55e;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      formatTabsSnapshot(tabs),
    );
  },
  closeTab: (tabId) => {
    console.log(
      "%c【标签操作】closeTab 被调用",
      "background:#ef4444;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      { 关闭ID: tabId, 调用栈: new Error().stack?.split("\n").slice(2, 8).join(" → ") },
    );
    set((state) => updateTabs(state, (tabs) => closeTabReducer(tabs, tabId)));
    const tabs = useUiStateStore.getState().tabs;
    console.log(
      "%c【标签操作】关闭标签后状态",
      "background:#ef4444;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      { 关闭ID: tabId, ...formatTabsSnapshot(tabs) },
    );
  },
  closeTabs: (tabIds) => {
    console.log(
      "%c【标签操作】closeTabs 被调用",
      "background:#ef4444;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      { 关闭IDs: tabIds, 调用栈: new Error().stack?.split("\n").slice(2, 8).join(" → ") },
    );
    set((state) => updateTabs(state, (tabs) => closeTabsReducer(tabs, tabIds)));
    const tabs = useUiStateStore.getState().tabs;
    console.log(
      "%c【标签操作】批量关闭后状态",
      "background:#ef4444;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      { 关闭的标签IDs: tabIds, ...formatTabsSnapshot(tabs) },
    );
  },
  activateTab: (tabId) => {
    set((state) => updateTabs(state, (tabs) => activateTabReducer(tabs, tabId)));
    const tabs = useUiStateStore.getState().tabs;
    console.log(
      "%c【标签操作】切换激活标签",
      "background:#f59e0b;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      { 切换至标签ID: tabId, ...formatTabsSnapshot(tabs) },
    );
  },
  setFocusedTab: (tabId) =>
    set((state) => updateTabs(state, (tabs) => setFocusedTabReducer(tabs, tabId))),
  reorderTabs: (draggedTabId, targetTabId) =>
    set((state) =>
      updateTabs(state, (tabs) => reorderTabsReducer(tabs, draggedTabId, targetTabId)),
    ),
  setTabCustomTitle: (tabId, customTitle) =>
    set((state) => updateTabs(state, (tabs) => setCustomTitleReducer(tabs, tabId, customTitle))),
  mergeTabs: (leftTabId, rightTabId) => {
    let merged = false;
    set((state) =>
      updateTabs(state, (tabs) => {
        const result = mergeTabsReducer(tabs, leftTabId, rightTabId);
        merged = result.ok;
        return result.state;
      }),
    );
    if (merged) {
      const tabs = useUiStateStore.getState().tabs;
      console.log(
        "%c【标签操作】合并分屏",
        "background:#8b5cf6;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
        { 左侧标签: leftTabId, 右侧标签: rightTabId, ...formatTabsSnapshot(tabs) },
      );
    }
    return merged;
  },
  splitMergedTabs: (tabId) => {
    set((state) => updateTabs(state, (tabs) => splitMergedTabsReducer(tabs, tabId)));
    const tabs = useUiStateStore.getState().tabs;
    console.log(
      "%c【标签操作】拆分分屏",
      "background:#8b5cf6;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      { 拆分标签ID: tabId, ...formatTabsSnapshot(tabs) },
    );
  },
  setTabSplitRatio: (leftTabId, rightTabId, ratio) =>
    set((state) =>
      updateTabs(state, (tabs) => setSplitRatioReducer(tabs, leftTabId, rightTabId, ratio)),
    ),
  setTabDiffOpen: (tabId, open) =>
    set((state) => updateTabs(state, (tabs) => setTabDiffOpenReducer(tabs, tabId, open))),
  pruneOrphanedServerTabs: (validThreadKeys) =>
    set((state) =>
      updateTabs(state, (tabs) => pruneOrphanedServerTabsReducer(tabs, validThreadKeys)),
    ),

  closeTabsByThreadIds: (environmentId, threadIds) => {
    console.log(
      "%c【标签操作】closeTabsByThreadIds 被调用",
      "background:#ef4444;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      {
        环境ID: environmentId,
        会话IDs: threadIds,
        调用栈: new Error().stack?.split("\n").slice(2, 8).join(" → "),
      },
    );
    set((state) =>
      updateTabs(state, (tabs) => closeTabsByThreadIdsReducer(tabs, environmentId, threadIds)),
    );
    const tabs = useUiStateStore.getState().tabs;
    console.log(
      "%c【标签操作】closeTabsByThreadIds 后状态",
      "background:#ef4444;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      { 环境ID: environmentId, 会话IDs: threadIds, ...formatTabsSnapshot(tabs) },
    );
  },
  promoteDraftTab: (draftId, threadRef) => {
    set((state) => updateTabs(state, (tabs) => promoteDraftTabReducer(tabs, draftId, threadRef)));
    const tabs = useUiStateStore.getState().tabs;
    console.log(
      "%c【标签操作】草稿标签升级为会话标签",
      "background:#6366f1;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
      {
        草稿ID: draftId,
        新会话: `${threadRef.environmentId}/${threadRef.threadId}`,
        ...formatTabsSnapshot(tabs),
      },
    );
  },
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("beforeunload", () => {
    const currentState = useUiStateStore.getState();
    console.log("【标签加载】beforeunload 触发，正在强制刷新持久化", {
      当前标签数量: currentState.tabs.group.tabIds.length,
      "当前标签 ID 列表": currentState.tabs.group.tabIds,
      "当前激活的标签 ID": currentState.tabs.group.activeTabId,
    });
    debouncedPersistState.flush();
    console.log("【标签加载】beforeunload 持久化刷新完成");
  });
}
