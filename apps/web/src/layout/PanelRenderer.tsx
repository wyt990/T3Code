"use client";

import type { ComponentType } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { ContextPanel } from "../contextAwareness/ContextPanel";
import { useWorkbenchContextBinding } from "../contextAwareness/useWorkbenchContextBinding";
import { EnvironmentPanel } from "../environmentManagement/EnvironmentPanel";
import { MultiAgentPanel } from "../multiAgent/MultiAgentPanel";
import { TestCoveragePanel } from "../testing/TestCoveragePanel";
import { VisualizationPanel } from "../visualization/VisualizationPanel";
import { useLayoutStore, isDockPanelDisplayed } from "./layoutStore";

interface PanelRendererProps {
  position?: "left" | "right" | "bottom";
  className?: string;
}

function ContextPanelLayoutSlot({ className }: { className?: string }) {
  const binding = useWorkbenchContextBinding();

  if (!binding.serverThreadKey || !binding.projectId || !binding.workspaceRoot) {
    return (
      <div
        className={`flex items-center justify-center p-4 text-xs text-gray-500 dark:text-gray-400 ${className ?? ""}`}
      >
        打开或切换到服务端会话标签后即可显示上下文分析。
      </div>
    );
  }

  const contextSession =
    binding.session !== null
      ? {
          threadId: binding.session.threadId as ThreadId,
          environmentId: binding.session.environmentId as EnvironmentId,
        }
      : null;

  return (
    <ContextPanel
      projectId={binding.projectId}
      workspaceRoot={binding.workspaceRoot}
      session={contextSession}
      className={className ?? ""}
    />
  );
}

function VisualizationPanelLayoutSlot({ className }: { className?: string }) {
  const binding = useWorkbenchContextBinding();

  return (
    <VisualizationPanel
      threadId={(binding.session?.threadId ?? null) as ThreadId | null}
      workspaceRoot={binding.workspaceRoot}
      projectId={binding.projectId ?? null}
      className={className ?? ""}
    />
  );
}

function EnvironmentPanelLayoutSlot({ className }: { className?: string }) {
  const binding = useWorkbenchContextBinding();

  return <EnvironmentPanel workspaceRoot={binding.workspaceRoot} className={className ?? ""} />;
}

function MultiAgentPanelLayoutSlot({ className }: { className?: string }) {
  const binding = useWorkbenchContextBinding();

  return (
    <MultiAgentPanel
      className={className}
      projectId={binding.projectId}
      threadId={(binding.session?.threadId ?? null) as ThreadId | null}
      modelSelection={binding.thread?.modelSelection}
      runtimeMode={binding.thread?.runtimeMode}
      interactionMode={binding.thread?.interactionMode}
    />
  );
}

const PANEL_COMPONENTS: Record<string, ComponentType<{ className?: string }>> = {
  context: ContextPanelLayoutSlot,
  visualization: VisualizationPanelLayoutSlot,
  testing: TestCoveragePanel,
  environment: EnvironmentPanelLayoutSlot,
  multiAgent: MultiAgentPanelLayoutSlot,
};

export function PanelRenderer({ position, className = "" }: PanelRendererProps) {
  const panels = useLayoutStore((s) => s.panels);

  const visiblePanels = panels.filter(
    (p) => isDockPanelDisplayed(p) && (!position || p.position === position),
  );

  if (visiblePanels.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {visiblePanels.map((panel) => {
        const PanelComponent = PANEL_COMPONENTS[panel.id];
        if (!PanelComponent) {
          return null;
        }
        return (
          <div
            key={panel.id}
            className={`flex-1 min-h-0 ${panel.collapsed ? "h-10" : ""}`}
            style={{
              flex: panel.position === "bottom" ? `0 0 ${panel.height}px` : "1",
            }}
          >
            <PanelComponent className="h-full" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Panel header with collapse toggle
 */
export function PanelHeader({
  title,
  collapsed,
  onToggleCollapse,
  onClose,
}: {
  title: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
      <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{title}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleCollapse}
          className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          title={collapsed ? "展开" : "折叠"}
        >
          {collapsed ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          )}
        </button>
        <button
          onClick={onClose}
          className="p-1 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
          title="关闭"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
