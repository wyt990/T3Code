"use client";

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { useCommandPaletteStore, type CommandItem } from "../commandPaletteStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { closeTabsAndSyncRoute } from "./TabBar/tabCloseBehavior";
import { pickAutoMergeCandidate } from "./TabBar/TabBar.logic";
import { findMergedPair } from "../uiTabsState";
import { useUiStateStore } from "../uiStateStore";

const NL_COMMAND_IDS = [
  "new-thread",
  "add-project",
  "settings",
  "close-tab",
  "merge-tabs",
  "split-tabs",
  "smart-context",
] as const;

/**
 * 在命令面板关闭时也保持挂载，向 `commandPaletteStore` 注册自然语言匹配所需的 `CommandItem`。
 * （`OpenCommandPaletteDialog` 仅在打开时挂载，否则 `parseNaturalLanguage` 永远拿不到 commands。）
 */
export function CommandPaletteNlBootstrap() {
  const navigate = useNavigate();
  const settings = useSettings();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();

  const runNewThread = useCallback(() => {
    void startNewThreadFromContext({
      activeDraftThread,
      activeThread,
      defaultProjectRef,
      defaultThreadEnvMode: settings.defaultThreadEnvMode,
      handleNewThread,
    })
      .catch(() => undefined)
      .finally(() => {
        useCommandPaletteStore.getState().setOpen(false);
      });
  }, [
    activeDraftThread,
    activeThread,
    defaultProjectRef,
    handleNewThread,
    settings.defaultThreadEnvMode,
  ]);

  const runAddProject = useCallback(() => {
    useCommandPaletteStore.getState().openAddProject();
  }, []);

  const runSettings = useCallback(() => {
    void navigate({ to: "/settings" }).finally(() => {
      useCommandPaletteStore.getState().setOpen(false);
    });
  }, [navigate]);

  const runCloseTab = useCallback(() => {
    const store = useUiStateStore.getState();
    const activeId = store.tabs.group.activeTabId;
    if (!activeId) {
      return;
    }
    void closeTabsAndSyncRoute({ tabIds: [activeId], navigate });
    useCommandPaletteStore.getState().setOpen(false);
  }, [navigate]);

  const runMergeTabs = useCallback(() => {
    const store = useUiStateStore.getState();
    const tabs = store.tabs;
    const activeId = tabs.group.activeTabId;
    const candidate = pickAutoMergeCandidate(tabs);
    if (!candidate) {
      return;
    }
    const idx = activeId ? tabs.group.tabIds.indexOf(activeId) : -1;
    const rightId = idx >= 0 ? tabs.group.tabIds[idx + 1] : undefined;
    if (activeId && rightId) {
      if (store.mergeTabs(activeId, rightId)) {
        useCommandPaletteStore.getState().setOpen(false);
        return;
      }
    }
    store.mergeTabs(candidate.leftTabId, candidate.rightTabId);
    useCommandPaletteStore.getState().setOpen(false);
  }, []);

  const runSplitTabs = useCallback(() => {
    const store = useUiStateStore.getState();
    const tabs = store.tabs;
    const activeId = tabs.group.activeTabId;
    if (!activeId) {
      return;
    }
    const pair = findMergedPair(tabs.group.mergedPairs, activeId);
    if (!pair) {
      return;
    }
    store.splitMergedTabs(activeId);
    useCommandPaletteStore.getState().setOpen(false);
  }, []);

  const runSmartContextHint = useCallback(() => {
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: "智能上下文与 TODO",
        description:
          "请打开侧边栏底部「工作台」→「上下文」，使用「刷新」或依赖/变更影响分析；也可在会话中直接让代理处理 TODO/FIXME。",
      }),
    );
    useCommandPaletteStore.getState().setOpen(false);
  }, []);

  useEffect(() => {
    const register = useCommandPaletteStore.getState().registerCommand;
    const items: CommandItem[] = [
      {
        id: "new-thread",
        title: "新建对话",
        description: "在当前默认项目新建会话",
        keywords: ["thread", "chat", "conversation"],
        category: "navigation",
        action: runNewThread,
      },
      {
        id: "add-project",
        title: "添加项目",
        description: "打开添加项目流程",
        keywords: ["project", "folder", "cwd"],
        category: "projects",
        action: runAddProject,
      },
      {
        id: "settings",
        title: "打开设置",
        keywords: ["preferences", "configuration", "keybindings"],
        category: "app",
        action: runSettings,
      },
      {
        id: "close-tab",
        title: "关闭当前标签",
        keywords: ["tab", "close"],
        category: "tabs",
        action: runCloseTab,
      },
      {
        id: "merge-tabs",
        title: "合并标签",
        keywords: ["merge", "combine"],
        category: "tabs",
        action: runMergeTabs,
      },
      {
        id: "split-tabs",
        title: "分离合并的标签",
        keywords: ["split", "unmerge"],
        category: "tabs",
        action: runSplitTabs,
      },
      {
        id: "smart-context",
        title: "智能上下文 / TODO 提示",
        description: "引导到工作台上下文能力",
        keywords: ["context", "analysis", "impact"],
        category: "help",
        action: runSmartContextHint,
      },
    ];

    for (const item of items) {
      register(item);
    }

    return () => {
      for (const id of NL_COMMAND_IDS) {
        useCommandPaletteStore.getState().unregisterCommand(id);
      }
    };
  }, [
    runAddProject,
    runCloseTab,
    runMergeTabs,
    runNewThread,
    runSettings,
    runSmartContextHint,
    runSplitTabs,
  ]);

  return null;
}
