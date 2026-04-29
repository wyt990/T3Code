import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { useCallback } from "react";

import ChatView from "../ChatView";
import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import type { MergedTabPair, Tab } from "../../uiTabsState";

import { SplitLayout } from "./SplitLayout";

export interface TabContentAreaProps {
  /**
   * The currently active tab. The TabBar layer guarantees this matches the URL
   * (or is `null` momentarily during URL → tab seeding).
   */
  activeTab: Tab | null;
  /**
   * When the active tab is part of a merged pair, this carries the pair plus
   * its sibling so the area can render a horizontal split. `null` for a
   * stand-alone tab.
   */
  mergedPair: MergedPairContext | null;
  /**
   * Which side currently owns focus when rendering a merged pair. Ignored when
   * `mergedPair` is `null`.
   */
  focusedSide: "left" | "right";
  /** Activate (and navigate to) the requested tab id. */
  onActivateTab: (tabId: string) => void;
  /** Persist the next divider position when the user drags. */
  onSplitRatioChange: (ratio: number) => void;
  /**
   * Lazy-mount marker forwarded to ChatView for the diff panel content.
   * Phase 1 keeps the existing "render diff content once it's been opened" optimization.
   */
  onDiffPanelOpen: () => void;
  /** Whether the chat header should reserve space for diff panel controls. */
  reserveTitleBarControlInset: boolean;
  /** Toggle diff panel open/closed for the active tab. */
  onToggleDiff: () => void;
  /** Pin the diff panel to a specific turn (and optionally file). */
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  /**
   * Activate or create a tab for `target` then navigate the URL. Used by
   * ChatView when, e.g., a plan-implementation flow promotes a draft and wants
   * the result surfaced.
   */
  onRequestThreadNavigation: (target: ScopedThreadRef) => Promise<void>;
  /** Same shape, for draft navigation. */
  onRequestDraftNavigation: (draftId: DraftId) => Promise<void>;
  /**
   * Phase 3.5 narrow-viewport adaptation. When true, a merged pair is rendered
   * as a single pane showing only the side currently designated by
   * `focusedSide`; the data underlying the pair is preserved so users can
   * unmerge or resize back on a wider screen without losing state.
   */
  narrowMergedOnlyShowFocused?: boolean;
}

export interface MergedPairContext {
  pair: MergedTabPair;
  leftTab: Tab;
  rightTab: Tab;
}

/**
 * Renders the visible content for the current tab(s).
 *
 * - Stand-alone tab → a single ChatView.
 * - Merged pair (Phase 2) → a horizontal `SplitLayout` with one ChatView per
 *   side. Click anywhere on a pane to make it focused; the parent navigates
 *   so the URL follows the focused tab's target. The diff panel layout still
 *   lives in `TabbedShell` because it's a sibling of `SidebarInset`.
 */
export function TabContentArea(props: Readonly<TabContentAreaProps>) {
  const {
    activeTab,
    mergedPair,
    focusedSide,
    onActivateTab,
    onSplitRatioChange,
    onDiffPanelOpen,
    reserveTitleBarControlInset,
    onToggleDiff,
    onOpenTurnDiff,
    onRequestThreadNavigation,
    onRequestDraftNavigation,
    narrowMergedOnlyShowFocused = false,
  } = props;

  const onRequestFocusLeft = useCallback(
    () => onActivateTab(mergedPair?.leftTab.id ?? ""),
    [mergedPair?.leftTab.id, onActivateTab],
  );
  const onRequestFocusRight = useCallback(
    () => onActivateTab(mergedPair?.rightTab.id ?? ""),
    [mergedPair?.rightTab.id, onActivateTab],
  );

  if (mergedPair && narrowMergedOnlyShowFocused) {
    // On narrow viewports the split layout would steal too much horizontal
    // space, so render only the focused half. The pair record itself is
    // untouched — switching back to a wider viewport restores the split.
    const visibleTab = focusedSide === "right" ? mergedPair.rightTab : mergedPair.leftTab;
    const onRequestFocus = focusedSide === "right" ? onRequestFocusRight : onRequestFocusLeft;
    return (
      <TabPaneContent
        tab={visibleTab}
        isFocused={true}
        onDiffPanelOpen={onDiffPanelOpen}
        reserveTitleBarControlInset={reserveTitleBarControlInset}
        onToggleDiff={onToggleDiff}
        onOpenTurnDiff={onOpenTurnDiff}
        onRequestThreadNavigation={onRequestThreadNavigation}
        onRequestDraftNavigation={onRequestDraftNavigation}
        onRequestFocus={onRequestFocus}
      />
    );
  }

  if (mergedPair) {
    const { leftTab, rightTab, pair } = mergedPair;
    return (
      <SplitLayout
        splitRatio={pair.splitRatio}
        onSplitRatioChange={onSplitRatioChange}
        focusedSide={focusedSide}
        onRequestFocusLeft={onRequestFocusLeft}
        onRequestFocusRight={onRequestFocusRight}
        leftPanel={
          <TabPaneContent
            tab={leftTab}
            isFocused={focusedSide === "left"}
            onDiffPanelOpen={onDiffPanelOpen}
            reserveTitleBarControlInset={reserveTitleBarControlInset}
            onToggleDiff={onToggleDiff}
            onOpenTurnDiff={onOpenTurnDiff}
            onRequestThreadNavigation={onRequestThreadNavigation}
            onRequestDraftNavigation={onRequestDraftNavigation}
            onRequestFocus={onRequestFocusLeft}
          />
        }
        rightPanel={
          <TabPaneContent
            tab={rightTab}
            isFocused={focusedSide === "right"}
            onDiffPanelOpen={onDiffPanelOpen}
            reserveTitleBarControlInset={reserveTitleBarControlInset}
            onToggleDiff={onToggleDiff}
            onOpenTurnDiff={onOpenTurnDiff}
            onRequestThreadNavigation={onRequestThreadNavigation}
            onRequestDraftNavigation={onRequestDraftNavigation}
            onRequestFocus={onRequestFocusRight}
          />
        }
      />
    );
  }

  if (!activeTab) {
    return null;
  }

  return (
    <TabPaneContent
      tab={activeTab}
      isFocused={true}
      onDiffPanelOpen={onDiffPanelOpen}
      reserveTitleBarControlInset={reserveTitleBarControlInset}
      onToggleDiff={onToggleDiff}
      onOpenTurnDiff={onOpenTurnDiff}
      onRequestThreadNavigation={onRequestThreadNavigation}
      onRequestDraftNavigation={onRequestDraftNavigation}
      onRequestFocus={noopRequestFocus}
    />
  );
}

const noopRequestFocus = () => {
  // Stand-alone tabs always own focus implicitly.
};

interface TabPaneContentProps {
  tab: Tab;
  isFocused: boolean;
  onDiffPanelOpen: () => void;
  reserveTitleBarControlInset: boolean;
  onToggleDiff: () => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onRequestThreadNavigation: (target: ScopedThreadRef) => Promise<void>;
  onRequestDraftNavigation: (draftId: DraftId) => Promise<void>;
  onRequestFocus: () => void;
}

/**
 * Single-tab pane renderer. Dispatches between server / draft branches and
 * forwards the per-tab `diffOpen` flag plus all navigation/diff callbacks to
 * the underlying ChatView.
 */
function TabPaneContent(props: Readonly<TabPaneContentProps>) {
  const {
    tab,
    isFocused,
    onDiffPanelOpen,
    reserveTitleBarControlInset,
    onToggleDiff,
    onOpenTurnDiff,
    onRequestThreadNavigation,
    onRequestDraftNavigation,
    onRequestFocus,
  } = props;

  if (tab.target.kind === "server") {
    const { threadRef } = tab.target;
    return (
      <ChatView
        environmentId={threadRef.environmentId}
        threadId={threadRef.threadId}
        onDiffPanelOpen={onDiffPanelOpen}
        reserveTitleBarControlInset={reserveTitleBarControlInset}
        routeKind="server"
        diffOpen={tab.diffOpen}
        onToggleDiff={onToggleDiff}
        onOpenTurnDiff={onOpenTurnDiff}
        onRequestThreadNavigation={onRequestThreadNavigation}
        onRequestDraftNavigation={onRequestDraftNavigation}
        isFocused={isFocused}
        onRequestFocus={onRequestFocus}
      />
    );
  }

  return (
    <DraftTabContent
      draftId={tab.target.draftId}
      isFocused={isFocused}
      onToggleDiff={onToggleDiff}
      onOpenTurnDiff={onOpenTurnDiff}
      onRequestThreadNavigation={onRequestThreadNavigation}
      onRequestDraftNavigation={onRequestDraftNavigation}
      onRequestFocus={onRequestFocus}
    />
  );
}

interface DraftTabContentProps {
  draftId: DraftId;
  isFocused: boolean;
  onToggleDiff: () => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onRequestThreadNavigation: (target: ScopedThreadRef) => Promise<void>;
  onRequestDraftNavigation: (draftId: DraftId) => Promise<void>;
  onRequestFocus: () => void;
}

/**
 * Draft tabs need a draft session lookup to provide ChatView with the
 * environment/thread metadata it expects. Extracted to keep the type narrowing
 * for the `draft` branch local.
 */
function DraftTabContent(props: Readonly<DraftTabContentProps>) {
  const {
    draftId,
    isFocused,
    onToggleDiff,
    onOpenTurnDiff,
    onRequestThreadNavigation,
    onRequestDraftNavigation,
    onRequestFocus,
  } = props;
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));

  if (!draftSession) {
    return null;
  }

  return (
    <ChatView
      draftId={draftId}
      environmentId={draftSession.environmentId}
      threadId={draftSession.threadId}
      routeKind="draft"
      diffOpen={false}
      onToggleDiff={onToggleDiff}
      onOpenTurnDiff={onOpenTurnDiff}
      onRequestThreadNavigation={onRequestThreadNavigation}
      onRequestDraftNavigation={onRequestDraftNavigation}
      isFocused={isFocused}
      onRequestFocus={onRequestFocus}
    />
  );
}
