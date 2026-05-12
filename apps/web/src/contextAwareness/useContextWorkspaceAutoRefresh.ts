"use client";

import { useEffect } from "react";

import { useContextStore } from "./contextStore";
import { useWorkbenchContextBinding } from "./useWorkbenchContextBinding";

/**
 * 在聊天壳（TabbedShell）挂载期间，随激活的服务端会话 / 项目切换自动刷新或清空全局智能上下文。
 */
export function useContextWorkspaceAutoRefresh(): void {
  const binding = useWorkbenchContextBinding();

  useEffect(() => {
    if (!binding.serverThreadKey) {
      useContextStore.getState().clearContext();
      return;
    }
    if (!binding.threadReady || binding.projectId === undefined || !binding.workspaceRoot) {
      return;
    }
    void useContextStore
      .getState()
      .refreshContext(binding.projectId, binding.workspaceRoot, binding.session ?? undefined);
  }, [
    binding.serverThreadKey,
    binding.threadReady,
    binding.projectId,
    binding.workspaceRoot,
    binding.session?.threadId,
    binding.session?.environmentId,
  ]);
}
