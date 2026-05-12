"use client";

import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import type { Thread } from "../types";
import { useUiStateStore } from "../uiStateStore";

/**
 * 优先使用标签栏当前激活的「服务端会话」标签；若无（例如仅有草稿、或无标签），再回退到路由上的 env/thread。
 * 用于增强工作台、侧栏上下文面板与全局上下文自动刷新，避免仅依赖 URL 时与标签激活态不一致。
 */
type ActiveTabContextKind = "none" | "server" | "draft";

export function useActiveServerThreadKeyForContext(): string | null {
  const params = useParams({ strict: false }) as {
    readonly environmentId?: string;
    readonly threadId?: string;
  };
  const fromTabs = useUiStateStore(
    useShallow((s) => {
      const id = s.tabs.group.activeTabId;
      if (!id) {
        return { key: null as string | null, kind: "none" as ActiveTabContextKind };
      }
      const tab = s.tabs.tabsById[id];
      if (!tab) {
        return { key: null, kind: "none" as ActiveTabContextKind };
      }
      if (tab.target.kind !== "server") {
        return { key: null, kind: "draft" as ActiveTabContextKind };
      }
      const r = tab.target.threadRef;
      return {
        key: `${r.environmentId}:${r.threadId}`,
        kind: "server" as ActiveTabContextKind,
      };
    }),
  );

  return useMemo(() => {
    if (fromTabs.kind === "draft") {
      return null;
    }
    if (fromTabs.key) {
      return fromTabs.key;
    }
    if (params.environmentId && params.threadId) {
      return `${params.environmentId}:${params.threadId}`;
    }
    return null;
  }, [fromTabs.key, fromTabs.kind, params.environmentId, params.threadId]);
}

export function useWorkbenchContextBinding(): {
  readonly serverThreadKey: string | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly projectId: ProjectId | undefined;
  readonly workspaceRoot: string;
  readonly session: { threadId: ThreadId; environmentId: EnvironmentId } | null;
  readonly threadReady: boolean;
  readonly thread: Thread | undefined;
} {
  const serverThreadKey = useActiveServerThreadKeyForContext();
  const threadRef = useMemo((): ScopedThreadRef | null => {
    if (!serverThreadKey) {
      return null;
    }
    const sep = serverThreadKey.indexOf(":");
    if (sep <= 0) {
      return null;
    }
    const env = serverThreadKey.slice(0, sep);
    const tid = serverThreadKey.slice(sep + 1);
    return scopeThreadRef(env as EnvironmentId, tid as ThreadId);
  }, [serverThreadKey]);

  const thread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const projectRef =
    thread !== undefined ? scopeProjectRef(thread.environmentId, thread.projectId) : null;
  const project = useStore((s) => selectProjectByRef(s, projectRef));

  const session = useMemo(() => {
    if (thread === undefined) {
      return null;
    }
    return {
      threadId: thread.id as ThreadId,
      environmentId: thread.environmentId as EnvironmentId,
    };
  }, [thread]);

  const workspaceRoot = project?.cwd ?? "";
  const threadReady = thread !== undefined && workspaceRoot.length > 0;

  return {
    serverThreadKey,
    threadRef,
    projectId: thread?.projectId as ProjectId | undefined,
    workspaceRoot,
    session,
    threadReady,
    thread,
  };
}
