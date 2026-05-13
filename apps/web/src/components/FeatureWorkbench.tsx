"use client";

import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CodeQualityPanel } from "./CodeQualityPanel";
import { ContextPanel } from "../contextAwareness/ContextPanel";
import { useContextStore } from "../contextAwareness/contextStore";
import { useWorkbenchContextBinding } from "../contextAwareness/useWorkbenchContextBinding";
import { EnvironmentPanel } from "../environmentManagement/EnvironmentPanel";
import { LayoutManager } from "../layout/LayoutManager";
import { MultiAgentPanel } from "../multiAgent/MultiAgentPanel";
import { TestCoveragePanel } from "../testing/TestCoveragePanel";
import { VisualizationPanel } from "../visualization/VisualizationPanel";
import { useMultiAgentStore } from "../multiAgent/multiAgentStore";
import { RIGHT_PANEL_SHEET_SHELL_TAILWIND } from "../rightPanelLayout";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetPanel,
  SheetTitle,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";

type WorkbenchTab = "context" | "multi" | "viz" | "tests" | "quality" | "env" | "layout";

export function FeatureWorkbenchSheet(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { open, onOpenChange } = props;
  const binding = useWorkbenchContextBinding();
  const projectId = binding.projectId;
  const workspaceRoot = binding.workspaceRoot;
  const contextSession = binding.session;
  const threadId = binding.session?.threadId ?? null;

  const [tab, setTab] = useState<WorkbenchTab>("context");
  const hydrateMultiAgent = useMultiAgentStore((s) => s.hydrateFromServer);
  const orchestrationStatus = binding.thread?.session?.orchestrationStatus ?? null;
  const prevOrchestrationStatus = useRef<string | null>(null);
  const prevOpen = useRef(false);

  useEffect(() => {
    if (!open || tab !== "context" || !projectId || !workspaceRoot) {
      return;
    }
    const prev = prevOrchestrationStatus.current;
    prevOrchestrationStatus.current = orchestrationStatus;
    const settled =
      orchestrationStatus === "ready" ||
      orchestrationStatus === "idle" ||
      orchestrationStatus === "stopped";
    if (prev === "running" && settled) {
      void useContextStore
        .getState()
        .refreshContext(projectId, workspaceRoot, contextSession ?? undefined);
    }
  }, [open, tab, projectId, workspaceRoot, contextSession, orchestrationStatus]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void hydrateMultiAgent();
  }, [open, hydrateMultiAgent]);

  /** 每次打开工作台时：有激活服务端会话则拉取上下文；否则清空，避免展示其它路由的残留数据 */
  useEffect(() => {
    if (!open) {
      prevOpen.current = false;
      return;
    }
    const becameOpen = !prevOpen.current;
    prevOpen.current = true;
    if (!becameOpen) {
      return;
    }
    if (!binding.serverThreadKey || !binding.threadReady || !projectId || !workspaceRoot) {
      useContextStore.getState().clearContext();
      return;
    }
    void useContextStore
      .getState()
      .refreshContext(projectId, workspaceRoot, contextSession ?? undefined);
  }, [
    open,
    binding.serverThreadKey,
    binding.threadReady,
    projectId,
    workspaceRoot,
    contextSession?.threadId,
    contextSession?.environmentId,
  ]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          "w-[min(100vw,560px)] gap-0 p-0 sm:max-w-[560px]",
          RIGHT_PANEL_SHEET_SHELL_TAILWIND,
        )}
      >
        {/* 关闭：底层全宽命中层 + SVG pointer-events-none，避免「线条间透明区」穿透到 Button 的 ::before（pointer-events-none）再落到下层 */}
        <div
          data-slot="sheet-header"
          className="relative flex flex-row items-center justify-between gap-2 border-b px-4 py-3"
        >
          <div className="min-w-0 flex-1 overflow-hidden pe-2">
            <SheetTitle className="truncate text-base">增强工作台</SheetTitle>
            <SheetDescription className="sr-only">
              上下文、多代理、可视化、测试、代码质量与环境管理
            </SheetDescription>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="关闭"
            className="relative z-10 shrink-0"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            <span
              aria-hidden
              className="pointer-events-auto absolute inset-0 z-0 rounded-[inherit]"
            />
            <XIcon className="relative z-10 size-4 shrink-0 pointer-events-none" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1 border-b px-2 py-2">
          <WorkbenchTabButton
            active={tab === "context"}
            label="上下文"
            onClick={() => setTab("context")}
          />
          <WorkbenchTabButton
            active={tab === "multi"}
            label="多代理"
            onClick={() => setTab("multi")}
          />
          <WorkbenchTabButton active={tab === "viz"} label="可视化" onClick={() => setTab("viz")} />
          <WorkbenchTabButton
            active={tab === "tests"}
            label="测试"
            onClick={() => setTab("tests")}
          />
          <WorkbenchTabButton
            active={tab === "quality"}
            label="代码质量"
            onClick={() => setTab("quality")}
          />
          <WorkbenchTabButton active={tab === "env"} label="环境" onClick={() => setTab("env")} />
          <WorkbenchTabButton
            active={tab === "layout"}
            label="布局"
            onClick={() => setTab("layout")}
          />
        </div>

        <SheetPanel className="h-[calc(100vh-10rem)] px-0 py-0" scrollFade={false}>
          {tab === "context" &&
            (binding.serverThreadKey && projectId && workspaceRoot ? (
              <ContextPanel
                projectId={projectId}
                workspaceRoot={workspaceRoot}
                session={contextSession}
              />
            ) : (
              <EmptyHint message="当前没有已打开的服务端会话标签，智能上下文不可用。请先打开或切换到会话标签。" />
            ))}
          {tab === "multi" && (
            <MultiAgentPanel
              className="min-h-[320px]"
              projectId={projectId}
              threadId={threadId as ThreadId | null}
              {...(binding.thread !== undefined
                ? {
                    modelSelection: binding.thread.modelSelection,
                    runtimeMode: binding.thread.runtimeMode,
                    interactionMode: binding.thread.interactionMode,
                  }
                : {})}
            />
          )}
          {tab === "viz" && (
            <VisualizationPanel
              threadId={threadId as ThreadId | null}
              workspaceRoot={workspaceRoot}
              projectId={projectId ?? null}
              className="min-h-[320px]"
            />
          )}
          {tab === "tests" && (
            <TestCoveragePanel
              className="min-h-[320px]"
              workspaceRoot={workspaceRoot}
              {...(projectId !== undefined ? { projectId } : {})}
            />
          )}
          {tab === "quality" &&
            (projectId ? (
              <CodeQualityPanel projectId={projectId} className="min-h-[320px]" />
            ) : (
              <EmptyHint message="请先打开某个项目下的会话，以便关联代码质量检查。" />
            ))}
          {tab === "env" && (
            <EnvironmentPanel workspaceRoot={workspaceRoot} className="min-h-[320px]" />
          )}
          {tab === "layout" && <LayoutManager className="min-h-[320px]" />}
        </SheetPanel>
      </SheetContent>
    </Sheet>
  );
}

function WorkbenchTabButton(props: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        props.active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/72 text-muted-foreground hover:bg-muted",
      )}
    >
      {props.label}
    </button>
  );
}

function EmptyHint(props: { readonly message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-center text-sm text-muted-foreground">{props.message}</p>
    </div>
  );
}
