import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { stripDiffSearchParams } from "../../diffRouteSearch";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useShouldUseRightPanelSheet } from "../../hooks/useShouldUseRightPanelSheet";
import { resolveSidebarNewThreadEnvMode } from "../Sidebar.logic";
import { useStore } from "../../store";
import { useUiStateStore } from "../../uiStateStore";
import {
  findMergedPair,
  type MergedTabPair,
  type Tab,
  type TabTarget,
  type UiTabsState,
} from "../../uiTabsState";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../../threadRoutes";
import { useSettings } from "../../hooks/useSettings";
import { useLayoutStore, isDockPanelDisplayed } from "../../layout/layoutStore";
import { useContextWorkspaceAutoRefresh } from "../../contextAwareness/useContextWorkspaceAutoRefresh";
import { cn } from "../../lib/utils";

import { DiffPanelInlineSidebar, LazyDiffPanel } from "../DiffPanelInlineSidebar";
import { RightPanelSheet } from "../RightPanelSheet";
import { SidebarInset } from "../ui/sidebar";
import { PanelRenderer } from "../../layout/PanelRenderer";

import { TabBar } from "./TabBar";
import { TabContentArea, type MergedPairContext } from "./TabContentArea";
import {
  decideTabActivation,
  nextTabId,
  pickAutoMergeCandidate,
  resolveTabTitle,
  tabTargetKey,
} from "./TabBar.logic";
import { closeTabsAndSyncRoute } from "./tabCloseBehavior";
import { isClosedTabTargetSuppressed } from "./tabCloseSuppression";
import { showTabsAtCapReplaceActiveToast } from "./tabsAtCapToast";

export interface TabbedShellProps {
  /**
   * The target the URL is currently pointing at. The shell guarantees a tab
   * exists for this target and activates it. `null` is allowed but only
   * happens transiently (e.g. before route params are resolved).
   */
  urlTarget: TabTarget | null;
  /**
   * If the route URL still carries the legacy `?diff=1` flag, the shell
   * hydrates it onto the active tab once and then strips it from the URL.
   */
  legacyDiffOpenInUrl?: boolean;
  /**
   * The current diff URL search params (e.g. `diffTurnId`, `diffFilePath`)
   * that DiffPanel reads. Owned by the leaf route; passed here so the shell
   * can re-issue navigations that preserve them when toggling diff or opening
   * a specific turn.
   */
  diffSearch?: Record<string, string | undefined>;
}

/**
 * Top-level shell for tab-based chat sessions.
 *
 * Phase 1 responsibilities:
 * - URL → tab sync (create-or-activate matching tab)
 * - Render the TabBar + ChatViews for open tabs (inactive panes stay mounted, hidden)
 * - Per-tab diff state (replaces the legacy `?diff=1` URL flag)
 * - Tab interactions: click-to-activate, click-to-close, [+] for new draft
 *
 * Phase 2 will extend `TabContentArea` with split rendering for merged pairs.
 */
export function TabbedShell(props: Readonly<TabbedShellProps>) {
  const { urlTarget, legacyDiffOpenInUrl } = props;
  const navigate = useNavigate();
  const tabs = useUiStateStore((state) => state.tabs);
  const activeTab = useMemo(() => {
    const fromUrl = deriveActiveTab(tabs, urlTarget);
    // 文件标签没有独立路由，优先使用 group.activeTabId 指向的文件标签
    const groupActiveId = tabs.group.activeTabId;
    if (groupActiveId) {
      const groupActive = tabs.tabsById[groupActiveId];
      if (groupActive?.target.kind === "file") return groupActive;
    }
    return fromUrl;
  }, [tabs, urlTarget]);
  const mergedPair = useMemo(() => deriveMergedPairContext(tabs, activeTab), [activeTab, tabs]);
  const focusedSide = useMemo(() => deriveFocusedSide(tabs, mergedPair), [mergedPair, tabs]);
  const orderedTabs = useMemo(() => buildOrderedTabs(tabs), [tabs]);
  const titleByTabId = useTabTitleMap(orderedTabs);

  // ── URL → tab sync ─────────────────────────────────────────────────────────
  useUrlTargetSync(urlTarget);
  useContextWorkspaceAutoRefresh();

  // ── Legacy `?diff=1` hydration (one-shot per URL) ──────────────────────────
  useLegacyDiffHydration({
    legacyDiffOpenInUrl: legacyDiffOpenInUrl === true,
    activeTabId: activeTab?.id ?? null,
    onStrip: useCallback(() => {
      if (!urlTarget) return;
      navigateAfterStrip(navigate, urlTarget);
    }, [navigate, urlTarget]),
  });

  // ── Diff panel layout (sheet vs sidebar) ───────────────────────────────────
  // Merged-pair view forces sheet mode regardless of width so the inline
  // sidebar doesn't compete with both ChatViews for horizontal space.
  // Otherwise we measure the SidebarInset container itself: viewport-only
  // media queries can't see the main sidebar that's already eating ~250px,
  // which is how the diff sidebar / plan sidebar end up overlapping the
  // composer at the typical 1024×676 startup window size.
  const isMergedView = mergedPair !== null;
  const { containerRef: sidebarInsetRef, shouldUseSheet: containerPrefersSheet } =
    useShouldUseRightPanelSheet();
  // In merged view the focused side owns the diff state; otherwise it's just
  // the active tab's. Phase 2.4 wires the focused-side diff toggle back into
  // `setTabDiffOpen` for that side specifically.
  const diffSourceTab = pickDiffSourceTab(mergedPair, focusedSide, activeTab);
  const diffOpen = diffSourceTab?.diffOpen ?? false;
  const [lockedDiffSheetMode, setLockedDiffSheetMode] = useState<boolean>(
    containerPrefersSheet || isMergedView,
  );
  useEffect(() => {
    // Merged mode always uses sheet and updates the lock immediately.
    if (isMergedView) {
      setLockedDiffSheetMode(true);
      return;
    }
    // When diff is closed, track live container preference. When diff is open,
    // keep the mode stable to avoid inline<->sheet oscillation caused by the
    // panel itself changing available width.
    if (!diffOpen) {
      setLockedDiffSheetMode(containerPrefersSheet);
    }
  }, [containerPrefersSheet, diffOpen, isMergedView]);
  const shouldUseDiffSheet = isMergedView
    ? true
    : diffOpen
      ? lockedDiffSheetMode
      : containerPrefersSheet;
  const { hasOpenedDiff, markDiffOpened } = useDiffMountState({
    activeTabId: diffSourceTab?.id ?? null,
    diffOpen,
  });
  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;

  // ── Tab interaction callbacks ──────────────────────────────────────────────
  const onActivateTab = useCallback(
    (tabId: string) => {
      const tab = tabs.tabsById[tabId];
      if (!tab) return;
      if (tab.target.kind === "file") {
        useUiStateStore.getState().activateTab(tabId);
        return;
      }
      // When the target already matches the current URL (e.g. a file tab is
      // active and the user clicks a same-project session tab), navigating
      // would be a no-op so useUrlTargetSync never fires. Activate directly.
      if (urlTarget && targetsEqual(tab.target, urlTarget)) {
        useUiStateStore.getState().activateTab(tabId);
        return;
      }
      void navigateToTarget(navigate, tab.target);
    },
    [navigate, tabs.tabsById, urlTarget],
  );

  const onCloseTab = useCallback(
    (tabId: string) => {
      closeTabsAndSyncRoute({ tabIds: [tabId], navigate });
    },
    [navigate],
  );

  const onCloseManyTabs = useCallback(
    (tabIds: readonly string[]) => {
      closeTabsAndSyncRoute({ tabIds, navigate });
    },
    [navigate],
  );

  const onRenameTab = useCallback((tabId: string, value: string) => {
    const trimmed = value.trim();
    useUiStateStore.getState().setTabCustomTitle(tabId, trimmed.length > 0 ? trimmed : null);
  }, []);

  const onResetTitle = useCallback((tabId: string) => {
    useUiStateStore.getState().setTabCustomTitle(tabId, null);
  }, []);

  const onSplitMergedPair = useCallback((tabId: string) => {
    useUiStateStore.getState().splitMergedTabs(tabId);
  }, []);

  const onReorderTabs = useCallback((draggedTabId: string, targetTabId: string) => {
    useUiStateStore.getState().reorderTabs(draggedTabId, targetTabId);
  }, []);

  const onMergeTabsByDrag = useCallback((leftTabId: string, rightTabId: string): boolean => {
    return useUiStateStore.getState().mergeTabs(leftTabId, rightTabId);
  }, []);

  const autoMergeCandidate = useMemo(() => pickAutoMergeCandidate(tabs), [tabs]);
  const onMergeAdjacent = useMemo(() => {
    if (!autoMergeCandidate) return null;
    return () => {
      useUiStateStore
        .getState()
        .mergeTabs(autoMergeCandidate.leftTabId, autoMergeCandidate.rightTabId);
    };
  }, [autoMergeCandidate]);

  const newThreadHandler = useHandleNewThread();
  const appSettings = useSettings();
  const onNewTab = useCallback(() => {
    const projectRef = newThreadHandler.defaultProjectRef;
    if (!projectRef) return;
    void newThreadHandler.handleNewThread(projectRef, {
      envMode: resolveSidebarNewThreadEnvMode({
        defaultEnvMode: appSettings.defaultThreadEnvMode,
      }),
    });
  }, [appSettings.defaultThreadEnvMode, newThreadHandler]);

  // ── ChatView/Diff callbacks (per focused tab) ──────────────────────────────
  // In merged view the diff acts on the focused side, otherwise on the active
  // (single) tab. `diffSourceTab` already encodes that distinction.
  const onToggleDiff = useCallback(() => {
    if (!diffSourceTab || diffSourceTab.target.kind !== "server") return;
    if (!diffSourceTab.diffOpen) {
      markDiffOpened();
    }
    useUiStateStore.getState().setTabDiffOpen(diffSourceTab.id, !diffSourceTab.diffOpen);
  }, [diffSourceTab, markDiffOpened]);

  const onOpenTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      if (!diffSourceTab || diffSourceTab.target.kind !== "server") return;
      markDiffOpened();
      useUiStateStore.getState().setTabDiffOpen(diffSourceTab.id, true);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(diffSourceTab.target.threadRef),
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, diffTurnId: turnId };
        },
      });
    },
    [diffSourceTab, markDiffOpened, navigate],
  );

  const closeDiff = useCallback(() => {
    if (!diffSourceTab) return;
    useUiStateStore.getState().setTabDiffOpen(diffSourceTab.id, false);
  }, [diffSourceTab]);

  const openDiff = useCallback(() => {
    if (!diffSourceTab) return;
    markDiffOpened();
    useUiStateStore.getState().setTabDiffOpen(diffSourceTab.id, true);
  }, [diffSourceTab, markDiffOpened]);

  const onSplitRatioChange = useCallback(
    (next: number) => {
      if (!mergedPair) return;
      useUiStateStore
        .getState()
        .setTabSplitRatio(mergedPair.leftTab.id, mergedPair.rightTab.id, next);
    },
    [mergedPair],
  );

  const onRequestThreadNavigation = useCallback(
    async (target: ScopedThreadRef) => {
      await navigateToTarget(navigate, { kind: "server", threadRef: target });
    },
    [navigate],
  );

  const onRequestDraftNavigation = useCallback(
    async (draftId: DraftId) => {
      await navigateToTarget(navigate, { kind: "draft", draftId });
    },
    [navigate],
  );

  /** 与 `PanelRenderer` 右侧 `fixed` 侧栏同宽，避免 ChatHeader（Git 操作等）画在面板下方造成叠字。底部面板在 `SidebarInset` 内流式排版，不再使用整视口 `fixed`。 */
  const layoutDock = useLayoutStore(
    useShallow((s) => {
      let padRight = false;
      let hasBottomDock = false;
      for (const p of s.panels) {
        if (!isDockPanelDisplayed(p)) {
          continue;
        }
        if (p.position === "right") {
          padRight = true;
        }
        if (p.position === "bottom") {
          hasBottomDock = true;
        }
      }
      return { padRight, hasBottomDock };
    }),
  );

  return (
    <>
      <SidebarInset
        ref={sidebarInsetRef}
        className={cn(
          "h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground",
          layoutDock.padRight && "pr-80",
        )}
      >
        <TabBar
          tabs={orderedTabs}
          mergedPairs={tabs.group.mergedPairs}
          activeTabId={activeTab?.id ?? tabs.group.activeTabId}
          focusedTabId={tabs.group.focusedTabId}
          titleByTabId={titleByTabId}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onCloseMany={onCloseManyTabs}
          onNewTab={onNewTab}
          onRename={onRenameTab}
          onResetTitle={onResetTitle}
          onSplitMergedPair={onSplitMergedPair}
          onMergeAdjacent={onMergeAdjacent}
          onReorderTabs={onReorderTabs}
          onMergeTabsByDrag={onMergeTabsByDrag}
          // On narrow viewports the split layout is not rendered, so a
          // drag-merge gesture would land in a place the user can't
          // immediately see. Suppress that intent and keep reorder.
          dragMergeDisabled={containerPrefersSheet}
        />
        <TabContentArea
          activeTab={activeTab}
          orderedTabs={orderedTabs}
          mergedPair={mergedPair}
          focusedSide={focusedSide}
          onActivateTab={onActivateTab}
          onSplitRatioChange={onSplitRatioChange}
          onDiffPanelOpen={markDiffOpened}
          reserveTitleBarControlInset={!shouldUseDiffSheet && !diffOpen}
          onToggleDiff={onToggleDiff}
          onOpenTurnDiff={onOpenTurnDiff}
          onRequestThreadNavigation={onRequestThreadNavigation}
          onRequestDraftNavigation={onRequestDraftNavigation}
          narrowMergedOnlyShowFocused={containerPrefersSheet}
        />
        {layoutDock.hasBottomDock ? (
          <div className="flex h-64 min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-border bg-background">
            <PanelRenderer position="bottom" className="h-full min-h-0 w-full" />
          </div>
        ) : null}
      </SidebarInset>
      {shouldUseDiffSheet ? (
        <RightPanelSheet variant="diff" open={diffOpen} onClose={closeDiff}>
          {/*
           * Phase 3.6 — RightPanelSheet keeps its children mounted across
           * open/close cycles. When the sheet is closed we apply
           * content-visibility:auto so the browser can skip layout/paint
           * for the kept-mounted but currently invisible subtree.
           */}
          <div
            className="flex h-full min-h-0 w-full min-w-0 flex-col"
            style={
              diffOpen ? undefined : { contentVisibility: "auto", containIntrinsicSize: "100dvh" }
            }
          >
            {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
          </div>
        </RightPanelSheet>
      ) : (
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
      )}
      {/* Right-side feature panels (non-diff) */}
      <PanelRenderer
        position="right"
        className="fixed right-0 top-[52px] bottom-0 w-80 z-30 wco:top-[env(titlebar-area-height)]"
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function deriveActiveTab(state: UiTabsState, urlTarget: TabTarget | null): Tab | null {
  if (!urlTarget) {
    return state.group.activeTabId ? (state.tabsById[state.group.activeTabId] ?? null) : null;
  }
  for (const tabId of state.group.tabIds) {
    const tab = state.tabsById[tabId];
    if (!tab) continue;
    if (targetsEqual(tab.target, urlTarget)) return tab;
  }
  return null;
}

function buildOrderedTabs(state: UiTabsState): Tab[] {
  return state.group.tabIds.flatMap((id) => {
    const tab = state.tabsById[id];
    return tab ? [tab] : [];
  });
}

/**
 * Resolve the merged pair the active tab participates in (if any), eagerly
 * pre-computing the left/right `Tab` records so consumers don't have to
 * re-look-up on every render. Returns `null` when the active tab is
 * stand-alone or when the pair entries are inconsistent (e.g. one side missing
 * from `tabsById`, which should only happen during persistence corruption).
 */
function deriveMergedPairContext(
  state: UiTabsState,
  activeTab: Tab | null,
): MergedPairContext | null {
  if (!activeTab) return null;
  const pair: MergedTabPair | null = findMergedPair(state.group.mergedPairs, activeTab.id);
  if (!pair) return null;
  const leftTab = state.tabsById[pair.leftTabId];
  const rightTab = state.tabsById[pair.rightTabId];
  if (!leftTab || !rightTab) return null;
  return { pair, leftTab, rightTab };
}

/**
 * Resolve the tab whose `diffOpen` should drive the diff panel. In merged view
 * the focused side wins; otherwise the stand-alone active tab. Returns `null`
 * during URL → tab seeding when no tab matches the URL yet.
 */
function pickDiffSourceTab(
  mergedPair: MergedPairContext | null,
  focusedSide: "left" | "right",
  activeTab: Tab | null,
): Tab | null {
  if (!mergedPair) return activeTab;
  return focusedSide === "left" ? mergedPair.leftTab : mergedPair.rightTab;
}

/**
 * Decide which side of the merged pair currently owns focus. Falls back to
 * "left" when nothing is focused (e.g. right after merging, before the user
 * clicks). Stand-alone tabs always report "left" — callers ignore the value
 * outside merged view.
 */
function deriveFocusedSide(
  state: UiTabsState,
  mergedPair: MergedPairContext | null,
): "left" | "right" {
  if (!mergedPair) return "left";
  const focused = state.group.focusedTabId;
  if (focused === mergedPair.rightTab.id) return "right";
  if (focused === mergedPair.leftTab.id) return "left";
  // Fall back to whichever side is active so the visual focus matches the URL.
  return state.group.activeTabId === mergedPair.rightTab.id ? "right" : "left";
}

/**
 * Compute a stable id → title map for the visible tabs. Pulls the underlying
 * server thread title or composer-draft prompt with shallow equality so the
 * TabBar only re-renders when one of those values actually changes.
 */
function useTabTitleMap(tabs: readonly Tab[]): Record<string, string> {
  const serverThreadTitleByKey = useStore(
    useShallow((state) => {
      const out: Record<string, string | null> = {};
      for (const tab of tabs) {
        if (tab.target.kind !== "server") continue;
        const env = state.environmentStateById[tab.target.threadRef.environmentId];
        const thread = env?.threadShellById[tab.target.threadRef.threadId];
        out[scopedThreadKey(tab.target.threadRef)] = thread?.title ?? null;
      }
      return out;
    }),
  );
  const draftPromptByDraftId = useComposerDraftStore(
    useShallow((state) => {
      const out: Record<string, string> = {};
      for (const tab of tabs) {
        if (tab.target.kind !== "draft") continue;
        const composer = state.getComposerDraft(tab.target.draftId);
        out[tab.target.draftId] = composer?.prompt ?? "";
      }
      return out;
    }),
  );
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const tab of tabs) {
      if (tab.target.kind === "server") {
        const key = scopedThreadKey(tab.target.threadRef);
        out[tab.id] = resolveTabTitle({
          tab,
          serverThreadTitle: serverThreadTitleByKey[key],
        });
      } else if (tab.target.kind === "draft") {
        out[tab.id] = resolveTabTitle({
          tab,
          draftPrompt: draftPromptByDraftId[tab.target.draftId],
        });
      } else {
        out[tab.id] = resolveTabTitle({ tab });
      }
    }
    return out;
  }, [tabs, serverThreadTitleByKey, draftPromptByDraftId]);
}

function targetsEqual(a: TabTarget, b: TabTarget): boolean {
  return tabTargetKey(a) === tabTargetKey(b);
}

async function navigateToTarget(
  navigate: ReturnType<typeof useNavigate>,
  target: TabTarget,
): Promise<void> {
  if (target.kind === "server") {
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(target.threadRef),
    });
    return;
  }
  if (target.kind === "draft") {
    await navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(target.draftId),
    });
    return;
  }
  // 文件标签无独立路由，激活仅改变 TabBar 视觉状态
}

function navigateAfterStrip(navigate: ReturnType<typeof useNavigate>, target: TabTarget): void {
  if (target.kind === "server") {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(target.threadRef),
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: undefined };
      },
    });
    return;
  }
  if (target.kind === "draft") {
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(target.draftId),
      replace: true,
    });
  }
  // 文件标签无路由，无需处理
}

/**
 * Ensure exactly one tab targets `urlTarget`. Creates a tab when none exists,
 * activates the matching one when it differs from the current active, and as a
 * last-resort replaces the active tab (with a fresh id) when the cap is hit.
 */
function useUrlTargetSync(urlTarget: TabTarget | null): void {
  const targetKey = urlTarget ? tabTargetKey(urlTarget) : null;
  const urlTargetRef = useRef(urlTarget);
  urlTargetRef.current = urlTarget;
  useEffect(() => {
    const currentTarget = urlTargetRef.current;
    if (!currentTarget) return;
    const tabs = useUiStateStore.getState().tabs;
    const decision = decideTabActivation(tabs, currentTarget);
    const targetLabel =
      currentTarget.kind === "server"
        ? `会话(${currentTarget.threadRef.environmentId}/${currentTarget.threadRef.threadId})`
        : currentTarget.kind === "draft"
          ? `草稿(${currentTarget.draftId})`
          : ""; // 文件标签不会出现在 URL 同步中

    if (decision.action === "activate-existing") {
      console.log(
        "%c【URL同步】已有标签，直接激活",
        "background:#f59e0b;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
        { 目标: targetLabel, 标签ID: decision.tabId, 是否已激活: decision.alreadyActive },
      );
      if (!decision.alreadyActive) {
        useUiStateStore.getState().activateTab(decision.tabId);
      }
      return;
    }
    if (decision.action === "create") {
      if (isClosedTabTargetSuppressed(currentTarget)) {
        console.log(
          "%c【URL同步】目标处于关闭抑制期，跳过创建",
          "background:#f97316;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
          { 目标: targetLabel },
        );
        return;
      }
      console.log(
        "%c【URL同步】新建标签",
        "background:#22c55e;color:white;font-weight:bold;padding:2px 4px;border-radius:2px",
        { 目标: targetLabel, 当前标签数: tabs.group.tabIds.length },
      );
      useUiStateStore.getState().createTab(currentTarget, { newTabId: nextTabId() });
      return;
    }
    const existingActiveId = tabs.group.activeTabId;
    const replaceActiveAndOpen = () => {
      if (existingActiveId) {
        useUiStateStore.getState().closeTab(existingActiveId);
      }
      useUiStateStore.getState().createTab(currentTarget, { newTabId: nextTabId() });
    };
    showTabsAtCapReplaceActiveToast(replaceActiveAndOpen);
  }, [targetKey]);
}

interface UseLegacyDiffHydrationArgs {
  legacyDiffOpenInUrl: boolean;
  activeTabId: string | null;
  onStrip: () => void;
}

/**
 * Hydrate the legacy `?diff=1` URL flag onto the active tab the first time we
 * see it, then strip it from the URL. Runs once per (tabId, true) pair so
 * navigating away and back through the same URL doesn't keep re-applying.
 */
function useLegacyDiffHydration(args: UseLegacyDiffHydrationArgs): void {
  const { legacyDiffOpenInUrl, activeTabId, onStrip } = args;
  const handledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!legacyDiffOpenInUrl || !activeTabId) return;
    const key = `${activeTabId}:open`;
    if (handledKeyRef.current === key) return;
    handledKeyRef.current = key;
    useUiStateStore.getState().setTabDiffOpen(activeTabId, true);
    onStrip();
  }, [activeTabId, legacyDiffOpenInUrl, onStrip]);
}

interface UseDiffMountStateArgs {
  activeTabId: string | null;
  diffOpen: boolean;
}

interface DiffMountState {
  hasOpenedDiff: boolean;
  markDiffOpened: () => void;
}

/**
 * Tracks whether the user has ever opened the diff panel for the active tab.
 * Used to keep the (lazy-loaded) DiffPanel mounted across rapid open/close
 * toggles without flashing the suspense fallback. Resets when the active tab
 * changes since each tab gets a fresh DiffPanel instance.
 */
function useDiffMountState(args: UseDiffMountStateArgs): DiffMountState {
  const { activeTabId, diffOpen } = args;
  const [state, setState] = useState(() => ({
    activeTabId,
    hasOpenedDiff: diffOpen,
  }));
  const hasOpenedDiff = state.activeTabId === activeTabId ? state.hasOpenedDiff : diffOpen;
  const markDiffOpened = useCallback(() => {
    setState((previous) => {
      if (previous.activeTabId === activeTabId && previous.hasOpenedDiff) {
        return previous;
      }
      return { activeTabId, hasOpenedDiff: true };
    });
  }, [activeTabId]);
  return { hasOpenedDiff, markDiffOpened };
}
