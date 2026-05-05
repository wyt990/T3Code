import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDownIcon, MergeIcon, PlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { readLocalApi } from "../../localApi";
import type { MergedTabPair, Tab } from "../../uiTabsState";

import {
  decideTabDragIntent,
  deriveDragOverFeedback,
  evaluateMergeAttempt,
  isTabInMergedPair,
  type TabDragIntent,
} from "./TabBar.dnd";
import {
  buildMergedTabMenuEntries,
  buildSingleTabMenuEntries,
  buildTabBarItemGroups,
  resolveTabTitle,
  type MenuEntry,
  type TabMergedMenuAction,
  type TabSingleMenuAction,
} from "./TabBar.logic";

export interface TabBarProps {
  /** Ordered list of visible tabs. */
  tabs: readonly Tab[];
  /** Merged pairs in the current group (used to fold pairs into one slot). */
  mergedPairs: readonly MergedTabPair[];
  /** Currently active tab (drives URL). */
  activeTabId: string | null;
  /** Currently focused tab (within a merged pair, may differ from active). */
  focusedTabId: string | null;
  /**
   * Optional title overrides. Provide either via this map (keyed by tab id) or
   * compute via {@link resolveTabTitle} at the call site. The map takes
   * precedence when present.
   */
  titleByTabId?: Record<string, string>;
  /**
   * Called when the user activates a tab (click). The TabBar does not mutate
   * any store state directly; the caller is expected to navigate the URL,
   * which in turn drives the active-tab sync in `TabbedShell`.
   */
  onActivate: (tabId: string) => void;
  /** Called when the user closes a tab (✕ button or middle-click). */
  onClose: (tabId: string) => void;
  /** Called when the user closes multiple tabs via context-menu actions. */
  onCloseMany: (tabIds: readonly string[]) => void;
  /** Called when the user clicks the trailing [+] button to open a new tab. */
  onNewTab: () => void;
  /** Called when the user commits a rename (Enter or blur). */
  onRename: (tabId: string, newTitle: string) => void;
  /** Called when the user picks "恢复自动标题" from the context menu. */
  onResetTitle: (tabId: string) => void;
  /** Called when the user picks "分离" on a merged pair. */
  onSplitMergedPair: (tabId: string) => void;
  /**
   * Called when the user clicks the toolbar "merge" button. When `null` the
   * action is hidden (no eligible pair, or cap reached).
   */
  onMergeAdjacent: (() => void) | null;
  /**
   * Persist a drag-reorder. Reducer signature is preserved for parity with
   * `useUiStateStore.reorderTabs`: the dragged tab is inserted in the slot
   * currently held by `targetTabId`, shifting downstream tabs forward.
   */
  onReorderTabs: (draggedTabId: string, targetTabId: string) => void;
  /**
   * Apply a drag-merge. Returns the boolean `mergeTabs` already returns so
   * the caller can react to rejection. Phase 3.2 only ever invokes this
   * when {@link evaluateMergeAttempt} pre-flight succeeds.
   */
  onMergeTabsByDrag: (leftTabId: string, rightTabId: string) => boolean;
  /**
   * Optional override for the drag activation distance (px). Defaults to 6,
   * which keeps simple clicks (≤5px jitter) from accidentally starting a
   * drag — important because every tab is also clickable to activate.
   */
  dragActivationDistancePx?: number;
  /**
   * Phase 3.5 narrow-viewport adaptation. When true, drag-merge intent is
   * suppressed: a drag with ⌥/Alt held is treated as plain reorder. Drop on
   * a merged tab is still rejected. The default behaviour (false) is the
   * desktop one.
   */
  dragMergeDisabled?: boolean;
  /** Optional className passthrough so callers can size the bar in layouts. */
  className?: string;
}

/**
 * Horizontal tab strip with [+] and merge actions. Includes click-to-activate,
 * click-to-close, click-to-create-new, double-click-to-rename, right-click
 * context menus, merged-pair rendering with dropdown, "merge last two"
 * toolbar button, and drag-and-drop reordering / merging (Phase 3.2).
 *
 * Drag intent ─ users hold ⌥/Alt while dragging to merge a pair; plain drags
 * reorder. Merged tabs may not be dragged or dropped onto.
 */
export function TabBar(props: Readonly<TabBarProps>) {
  const {
    tabs,
    mergedPairs,
    activeTabId,
    focusedTabId,
    titleByTabId,
    onActivate,
    onClose,
    onCloseMany,
    onNewTab,
    onRename,
    onResetTitle,
    onSplitMergedPair,
    onMergeAdjacent,
    onReorderTabs,
    onMergeTabsByDrag,
    dragActivationDistancePx = 6,
    dragMergeDisabled = false,
    className,
  } = props;

  const computedTitleById = useMemo(() => {
    if (titleByTabId) return titleByTabId;
    const out: Record<string, string> = {};
    for (const tab of tabs) {
      out[tab.id] = resolveTabTitle({ tab });
    }
    return out;
  }, [tabs, titleByTabId]);

  const groups = useMemo(() => buildTabBarItemGroups(tabs, mergedPairs), [mergedPairs, tabs]);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const startEditing = useCallback((tabId: string) => setEditingTabId(tabId), []);
  const stopEditing = useCallback(() => setEditingTabId(null), []);
  const commitEditing = useCallback(
    (tabId: string, value: string) => {
      onRename(tabId, value);
      setEditingTabId((current) => (current === tabId ? null : current));
    },
    [onRename],
  );

  // Drag-and-drop ────────────────────────────────────────────────────────────
  // Sortable items track every visible top-level tab. Members of a merged
  // pair are still listed (so positions remain stable in the row's geometry),
  // but their useSortable wrapper sets `disabled: true` to block both grab
  // and drop interactions.
  const sortableItems = useMemo(
    () => groups.map((group) => (group.kind === "single" ? group.tab.id : group.pair.leftTabId)),
    [groups],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: dragActivationDistancePx },
    }),
  );

  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragIntent, setDragIntent] = useState<TabDragIntent>("reorder");
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      setDraggedTabId(id);
      // `activatorEvent` may be a PointerEvent, MouseEvent, or KeyboardEvent
      // depending on which sensor produced it. Fall back to `false` when the
      // event does not carry an altKey (e.g. synthesized events in tests).
      const altKeyHeld =
        typeof event.activatorEvent === "object" &&
        event.activatorEvent !== null &&
        "altKey" in event.activatorEvent &&
        Boolean((event.activatorEvent as { altKey?: boolean }).altKey);
      // Narrow viewports demote the merge gesture to a plain reorder so
      // touch/keyboard users can still rearrange tabs without the cap-aware
      // merge feedback path.
      setDragIntent(decideTabDragIntent(dragMergeDisabled ? false : altKeyHeld));
    },
    [dragMergeDisabled],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setDragOverTabId(event.over ? String(event.over.id) : null);
  }, []);

  const handleDragCancel = useCallback(() => {
    setDraggedTabId(null);
    setDragOverTabId(null);
    setDragIntent("reorder");
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const draggedId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      const intent = dragIntent;
      setDraggedTabId(null);
      setDragOverTabId(null);
      setDragIntent("reorder");

      if (!overId || draggedId === overId) return;
      if (isTabInMergedPair(draggedId, mergedPairs)) return;

      if (intent === "merge") {
        const outcome = evaluateMergeAttempt({
          draggedTabId: draggedId,
          targetTabId: overId,
          mergedPairs,
        });
        if (outcome.kind === "ok") {
          onMergeTabsByDrag(outcome.leftTabId, outcome.rightTabId);
        }
        return;
      }

      if (isTabInMergedPair(overId, mergedPairs)) return;
      onReorderTabs(draggedId, overId);
    },
    [dragIntent, mergedPairs, onMergeTabsByDrag, onReorderTabs],
  );

  const draggedTab = draggedTabId ? (tabs.find((tab) => tab.id === draggedTabId) ?? null) : null;
  const draggedTitle = draggedTab ? (computedTitleById[draggedTab.id] ?? "") : "";
  const overFeedback = useMemo(() => {
    if (!draggedTabId) {
      return { blocked: false, isMergeIntent: false };
    }
    return deriveDragOverFeedback({
      draggedTabId,
      overTabId: dragOverTabId,
      intent: dragIntent,
      mergedPairs,
    });
  }, [dragIntent, dragOverTabId, draggedTabId, mergedPairs]);

  const orderedTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);

  // ── Right-click menu dispatchers ──────────────────────────────────────────
  // The list of legal menu entries depends on neighbours and the merged-pair
  // cap, so it's computed by `buildSingleTabMenuEntries`/`buildMergedTabMenuEntries`
  // (pure, unit-tested). The TabBar resolves the action ids back into the
  // existing prop callbacks here so children stay agnostic about merge math.
  const closeOtherTabsExcept = useCallback(
    (keepTabIds: ReadonlySet<string>) => {
      const toClose = orderedTabIds.filter((tabId) => !keepTabIds.has(tabId));
      onCloseMany(toClose);
    },
    [onCloseMany, orderedTabIds],
  );

  const handleSingleMenuAction = useCallback(
    (tab: Tab, action: TabSingleMenuAction) => {
      switch (action) {
        case "rename":
          startEditing(tab.id);
          return;
        case "reset-title":
          onResetTitle(tab.id);
          return;
        case "close":
          onClose(tab.id);
          return;
        case "close-others":
          closeOtherTabsExcept(new Set([tab.id]));
          return;
        case "close-to-right": {
          const idx = orderedTabIds.indexOf(tab.id);
          if (idx < 0) return;
          onCloseMany(orderedTabIds.slice(idx + 1));
          return;
        }
        case "merge-with-right": {
          const idx = orderedTabIds.indexOf(tab.id);
          const rightId = idx >= 0 ? orderedTabIds[idx + 1] : undefined;
          if (!rightId) return;
          const outcome = evaluateMergeAttempt({
            draggedTabId: rightId,
            targetTabId: tab.id,
            mergedPairs,
          });
          if (outcome.kind === "ok") {
            onMergeTabsByDrag(outcome.leftTabId, outcome.rightTabId);
          }
          return;
        }
        case "split":
          onSplitMergedPair(tab.id);
          return;
      }
    },
    [
      closeOtherTabsExcept,
      mergedPairs,
      onClose,
      onCloseMany,
      onMergeTabsByDrag,
      onResetTitle,
      onSplitMergedPair,
      orderedTabIds,
      startEditing,
    ],
  );

  const handleMergedMenuAction = useCallback(
    (pair: { leftTabId: string; rightTabId: string }, action: TabMergedMenuAction) => {
      switch (action) {
        case "split":
          onSplitMergedPair(pair.leftTabId);
          return;
        case "rename-left":
          startEditing(pair.leftTabId);
          return;
        case "rename-right":
          startEditing(pair.rightTabId);
          return;
        case "reset-title-left":
          onResetTitle(pair.leftTabId);
          return;
        case "reset-title-right":
          onResetTitle(pair.rightTabId);
          return;
        case "close-left":
          onClose(pair.leftTabId);
          return;
        case "close-right":
          onClose(pair.rightTabId);
          return;
        case "close-pair":
          onCloseMany([pair.leftTabId, pair.rightTabId]);
          return;
        case "close-others":
          closeOtherTabsExcept(new Set([pair.leftTabId, pair.rightTabId]));
          return;
      }
    },
    [closeOtherTabsExcept, onClose, onCloseMany, onResetTitle, onSplitMergedPair, startEditing],
  );

  return (
    <div
      role="tablist"
      aria-label="Open chats"
      data-testid="tab-bar"
      className={cn(
        "flex h-9 w-full shrink-0 items-stretch gap-1 border-b border-border bg-background/80 px-2",
        // Electron (Windows) overlays the native window controls (─ □ ✕) on top
        // of the web content via `titleBarOverlay`. We therefore (1) match the
        // overlay's height so the tab row is the same row as the controls and
        // (2) reserve right-side padding equal to the overlay width so [+] /
        // merge buttons never slide under the controls. macOS uses
        // `titleBarStyle: "hiddenInset"` and traffic lights live at the top-left
        // (handled by Sidebar's `wco:pl-[calc(env(titlebar-area-x)+1em)]`), so
        // no right-side reservation is needed there.
        "wco:h-[env(titlebar-area-height)] wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
        className,
      )}
    >
      {/*
        Layout intent (matches `doc/标签式会话设计方案.md` line 63-73):
          [tabs (natural width, scrollable when overflowing)] [actions]   <drag spacer>
        ──────────────────────────────────────────────────────────────────
        - The tabs row uses `min-w-0` (no `flex-grow`) so it sizes to its
          contents; when a 6-tab group exceeds the available width the row
          scrolls horizontally instead of pushing the actions off-screen.
        - The action row is `shrink-0` so [+] / merge sit immediately after
          the rightmost tab — never pinned to the window's right edge where
          the Electron window controls live.
        - The trailing `flex-1` spacer fills the remainder and is marked as
          `drag-region` (CSS `app-region: drag`) so users can grab the empty
          area to move a frameless window.
      */}
      <DndContext
        sensors={sensors}
        modifiers={[restrictToHorizontalAxis]}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={sortableItems} strategy={horizontalListSortingStrategy}>
          <div
            className="flex min-w-0 items-stretch gap-1 overflow-x-auto"
            data-tab-bar-drag-blocked={overFeedback.blocked ? "true" : undefined}
          >
            {groups.map((group) =>
              group.kind === "single" ? (
                <SortableTabSlot
                  key={group.tab.id}
                  tabId={group.tab.id}
                  disabled={false}
                  isMergeTarget={overFeedback.isMergeIntent && dragOverTabId === group.tab.id}
                  isMergeBlocked={overFeedback.blocked && dragOverTabId === group.tab.id}
                >
                  <TabBarSingleItem
                    tab={group.tab}
                    title={computedTitleById[group.tab.id] ?? ""}
                    isActive={group.tab.id === activeTabId}
                    isFocused={group.tab.id === focusedTabId}
                    isEditing={editingTabId === group.tab.id}
                    isDraggingPlaceholder={draggedTabId === group.tab.id}
                    menuEntries={buildSingleTabMenuEntries({
                      tab: group.tab,
                      orderedTabIds,
                      mergedPairs,
                      tabTitle: computedTitleById[group.tab.id] ?? "",
                    })}
                    onActivate={onActivate}
                    onClose={onClose}
                    onStartEditing={startEditing}
                    onCommitEditing={commitEditing}
                    onCancelEditing={stopEditing}
                    onMenuAction={handleSingleMenuAction}
                  />
                </SortableTabSlot>
              ) : (
                <SortableTabSlot
                  key={group.pair.leftTabId}
                  tabId={group.pair.leftTabId}
                  disabled
                  isMergeTarget={false}
                  isMergeBlocked={
                    overFeedback.blocked &&
                    (dragOverTabId === group.pair.leftTabId ||
                      dragOverTabId === group.pair.rightTabId)
                  }
                >
                  <TabBarMergedItem
                    pair={group.pair}
                    leftTab={group.leftTab}
                    rightTab={group.rightTab}
                    leftTitle={computedTitleById[group.leftTab.id] ?? ""}
                    rightTitle={computedTitleById[group.rightTab.id] ?? ""}
                    activeTabId={activeTabId}
                    focusedTabId={focusedTabId}
                    menuEntries={buildMergedTabMenuEntries({
                      pair: group.pair,
                      leftTab: group.leftTab,
                      rightTab: group.rightTab,
                      leftTitle: computedTitleById[group.leftTab.id] ?? "",
                      rightTitle: computedTitleById[group.rightTab.id] ?? "",
                      orderedTabIds,
                    })}
                    onActivate={onActivate}
                    onMenuAction={handleMergedMenuAction}
                  />
                </SortableTabSlot>
              ),
            )}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {draggedTab ? (
            <div
              data-testid="tab-bar-drag-overlay"
              className={cn(
                "flex h-9 min-w-[8rem] max-w-[14rem] items-center gap-1 rounded-md px-2 text-sm shadow-lg",
                "bg-popover text-foreground border border-border opacity-95",
              )}
            >
              <span className="truncate">{draggedTitle}</span>
              {dragIntent === "merge" ? (
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                  合并
                </span>
              ) : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <div className="flex shrink-0 items-stretch gap-1">
        {onMergeAdjacent ? (
          <button
            type="button"
            aria-label="合并最后两个标签页"
            title="合并最后两个标签页 (Ctrl+\\)"
            data-testid="tab-bar-merge"
            onClick={onMergeAdjacent}
            className={cn(
              "flex items-center justify-center rounded-md px-2 text-muted-foreground",
              "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-ring",
            )}
          >
            <MergeIcon className="size-4" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="新建会话标签页"
          title="新建会话 (Ctrl+T)"
          data-testid="tab-bar-new"
          onClick={onNewTab}
          className={cn(
            "flex items-center justify-center rounded-md px-2 text-muted-foreground",
            "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2",
            "focus-visible:ring-ring",
          )}
        >
          <PlusIcon className="size-4" aria-hidden />
        </button>
      </div>
      <div aria-hidden data-testid="tab-bar-trailing-spacer" className="drag-region flex-1" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sortable wrapper
// ──────────────────────────────────────────────────────────────────────────────

interface SortableTabSlotProps {
  tabId: string;
  disabled: boolean;
  isMergeTarget: boolean;
  isMergeBlocked: boolean;
  children: React.ReactNode;
}

function SortableTabSlot(props: Readonly<SortableTabSlotProps>) {
  const { tabId, disabled, isMergeTarget, isMergeBlocked, children } = props;
  const { setNodeRef, attributes, listeners, transform, transition, isDragging, isOver } =
    useSortable({ id: tabId, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      data-sortable-tab-id={tabId}
      data-tab-merge-target={isMergeTarget ? "true" : undefined}
      data-tab-merge-blocked={isMergeBlocked ? "true" : undefined}
      className={cn(
        "relative flex shrink-0 items-stretch",
        isDragging && "opacity-40",
        isMergeTarget && "ring-2 ring-primary/70 rounded-md",
        isMergeBlocked && "ring-2 ring-destructive/60 rounded-md cursor-no-drop",
        !disabled &&
          !isMergeBlocked &&
          isOver &&
          !isMergeTarget &&
          "ring-1 ring-primary/40 rounded-md",
      )}
    >
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Single tab
// ──────────────────────────────────────────────────────────────────────────────

interface TabBarSingleItemProps {
  tab: Tab;
  title: string;
  isActive: boolean;
  isFocused: boolean;
  isEditing: boolean;
  /**
   * When true, the item is currently the drag source's "ghost" — keep it in
   * place for sortable measurement but render at low opacity so users see
   * the DragOverlay as the canonical preview.
   */
  isDraggingPlaceholder?: boolean;
  /** Pre-computed right-click menu entries (Phase 3.3). */
  menuEntries: readonly MenuEntry<TabSingleMenuAction>[];
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onStartEditing: (tabId: string) => void;
  onCommitEditing: (tabId: string, value: string) => void;
  onCancelEditing: () => void;
  onMenuAction: (tab: Tab, action: TabSingleMenuAction) => void;
}

function TabBarSingleItem(props: Readonly<TabBarSingleItemProps>) {
  const {
    tab,
    title,
    isActive,
    isFocused,
    isEditing,
    isDraggingPlaceholder = false,
    menuEntries,
    onActivate,
    onClose,
    onStartEditing,
    onCommitEditing,
    onCancelEditing,
    onMenuAction,
  } = props;
  const handleActivate = useCallback(() => {
    if (isEditing) return;
    onActivate(tab.id);
  }, [isEditing, onActivate, tab.id]);
  const handleAuxClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button === 1) {
        event.preventDefault();
        onClose(tab.id);
      }
    },
    [onClose, tab.id],
  );
  const handleCloseClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onClose(tab.id);
    },
    [onClose, tab.id],
  );
  const handleDoubleClick = useCallback(() => onStartEditing(tab.id), [onStartEditing, tab.id]);
  const handleContextMenu = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const api = readLocalApi();
      if (!api) return;
      const enabledItems = menuEntries
        .filter((entry) => !entry.disabled)
        .map((entry) => ({ id: entry.id, label: entry.label }));
      if (enabledItems.length === 0) return;
      const clicked = await api.contextMenu.show(enabledItems, {
        x: event.clientX,
        y: event.clientY,
      });
      if (!clicked) return;
      onMenuAction(tab, clicked);
    },
    [menuEntries, onMenuAction, tab],
  );

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-tab-id={tab.id}
      data-tab-active={isActive ? "true" : undefined}
      data-tab-focused={isFocused ? "true" : undefined}
      data-tab-drag-placeholder={isDraggingPlaceholder ? "true" : undefined}
      data-testid="tab-bar-item"
      onContextMenu={handleContextMenu}
      className={cn(
        "group/tab relative flex h-full min-w-[8rem] max-w-[14rem] cursor-pointer items-center gap-1 rounded-md px-2",
        "text-sm text-muted-foreground transition-colors",
        "hover:bg-muted/60 hover:text-foreground",
        isActive && "bg-muted text-foreground font-medium",
        isFocused && "shadow-[inset_0_-2px_0_0_var(--primary)]",
        isDraggingPlaceholder && "pointer-events-none opacity-30",
      )}
    >
      {isEditing ? (
        <TabRenameInput
          initialValue={tab.customTitle ?? title}
          onCommit={(value) => onCommitEditing(tab.id, value)}
          onCancel={onCancelEditing}
        />
      ) : (
        <button
          type="button"
          onClick={handleActivate}
          onMouseDown={handleAuxClick}
          onDoubleClick={handleDoubleClick}
          title={title}
          className="flex flex-1 items-center gap-1 truncate text-left focus-visible:outline-none"
        >
          <span className="truncate">{title}</span>
        </button>
      )}
      <button
        type="button"
        aria-label="Close tab"
        title="Close tab (Ctrl+W)"
        data-testid="tab-bar-close"
        onClick={handleCloseClick}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70",
          "opacity-0 transition group-hover/tab:opacity-100 hover:bg-muted hover:text-foreground",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "opacity-100",
        )}
      >
        <XIcon className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Merged pair
// ──────────────────────────────────────────────────────────────────────────────

interface TabBarMergedItemProps {
  pair: MergedTabPair;
  leftTab: Tab;
  rightTab: Tab;
  leftTitle: string;
  rightTitle: string;
  activeTabId: string | null;
  focusedTabId: string | null;
  /** Pre-computed right-click menu entries (Phase 3.3). */
  menuEntries: readonly MenuEntry<TabMergedMenuAction>[];
  onActivate: (tabId: string) => void;
  onMenuAction: (
    pair: { leftTabId: string; rightTabId: string },
    action: TabMergedMenuAction,
  ) => void;
}

function TabBarMergedItem(props: Readonly<TabBarMergedItemProps>) {
  const {
    pair,
    leftTab,
    rightTab,
    leftTitle,
    rightTitle,
    activeTabId,
    focusedTabId,
    menuEntries,
    onActivate,
    onMenuAction,
  } = props;
  const isActive = activeTabId === leftTab.id || activeTabId === rightTab.id;
  const leftFocused = focusedTabId === leftTab.id;
  const rightFocused = focusedTabId === rightTab.id;

  const showMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const enabledItems = menuEntries
        .filter((entry) => !entry.disabled)
        .map((entry) => ({ id: entry.id, label: entry.label }));
      if (enabledItems.length === 0) return;
      const clicked = await api.contextMenu.show(enabledItems, position);
      if (!clicked) return;
      onMenuAction({ leftTabId: pair.leftTabId, rightTabId: pair.rightTabId }, clicked);
    },
    [menuEntries, onMenuAction, pair.leftTabId, pair.rightTabId],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      void showMenu({ x: event.clientX, y: event.clientY });
    },
    [showMenu],
  );

  const handleMenuButton = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      void showMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom) });
    },
    [showMenu],
  );

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-tab-id={pair.leftTabId}
      data-tab-merged="true"
      data-tab-active={isActive ? "true" : undefined}
      data-testid="tab-bar-merged-item"
      onContextMenu={handleContextMenu}
      className={cn(
        "group/tab relative flex h-full min-w-[16rem] max-w-[28rem] cursor-pointer items-center rounded-md",
        "text-sm text-muted-foreground transition-colors",
        "hover:bg-muted/60 hover:text-foreground",
        isActive && "bg-muted text-foreground",
      )}
    >
      <button
        type="button"
        onClick={() => onActivate(leftTab.id)}
        title={leftTitle}
        data-testid="tab-bar-merged-left"
        className={cn(
          "flex h-full min-w-0 flex-1 items-center px-2 truncate text-left focus-visible:outline-none",
          leftFocused && "font-semibold text-foreground",
        )}
      >
        <span className="truncate">{leftTitle}</span>
      </button>
      <span aria-hidden className="select-none px-1 text-muted-foreground/60">
        |
      </span>
      <button
        type="button"
        onClick={() => onActivate(rightTab.id)}
        title={rightTitle}
        data-testid="tab-bar-merged-right"
        className={cn(
          "flex h-full min-w-0 flex-1 items-center px-2 truncate text-left focus-visible:outline-none",
          rightFocused && "font-semibold text-foreground",
        )}
      >
        <span className="truncate">{rightTitle}</span>
      </button>
      <button
        type="button"
        aria-label="Merged pair menu"
        title="More actions"
        data-testid="tab-bar-merged-menu"
        onClick={handleMenuButton}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 mr-1",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <ChevronDownIcon className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Rename input
// ──────────────────────────────────────────────────────────────────────────────

interface TabRenameInputProps {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function TabRenameInput(props: Readonly<TabRenameInputProps>) {
  const { initialValue, onCommit, onCancel } = props;
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onCommit(value);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    },
    [onCancel, onCommit, value],
  );

  const handleBlur = useCallback(() => {
    onCommit(value);
  }, [onCommit, value]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      data-testid="tab-bar-rename-input"
      className={cn(
        "flex-1 min-w-0 bg-transparent text-sm text-foreground outline-none",
        "placeholder:text-muted-foreground/60",
      )}
    />
  );
}
