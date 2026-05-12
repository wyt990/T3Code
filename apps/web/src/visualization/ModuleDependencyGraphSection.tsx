"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DependencyGraph, ProjectId } from "@t3tools/contracts";

import { DependencyGraphFlow } from "../contextAwareness/DependencyGraphFlow";
import { buildImpactHighlightFromChangeImpact } from "../contextAwareness/dependencyImpactHighlight";
import {
  useChangeImpact,
  useContextStore,
  useImpactAnalyzing,
} from "../contextAwareness/contextStore";
import { readPrimaryWsRpcClient } from "../rpc/wsClientHelpers";

import { ModuleDependencyGraphD3 } from "./ModuleDependencyGraphD3";

const GLOBAL_MAX_NODES = 200;

type Engine = "xyflow" | "d3";

export function ModuleDependencyGraphSection(props: {
  readonly workspaceRoot: string;
  readonly projectId?: ProjectId | null;
}) {
  const root = props.workspaceRoot.trim();
  const projectId = props.projectId ?? null;
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine>("xyflow");
  const [impactPath, setImpactPath] = useState("");
  const [hopDepth, setHopDepth] = useState(2);

  const changeImpact = useChangeImpact();
  const impactHighlight = useMemo(
    () => buildImpactHighlightFromChangeImpact(changeImpact),
    [changeImpact],
  );
  const isImpactAnalyzing = useImpactAnalyzing();

  const load = useCallback(async () => {
    if (root.length === 0) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const client = readPrimaryWsRpcClient();
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const g = await client.context.buildDependencyGraph({ workspaceRoot: root });
      setGraph(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void load();
  }, [load]);

  const runImpactAnalysis = useCallback(() => {
    if (projectId === null) {
      return;
    }
    void useContextStore.getState().analyzeChangeImpact(projectId, root, impactPath, hopDepth);
  }, [projectId, root, impactPath, hopDepth]);

  if (root.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground py-6">
        需要已绑定项目的工作区根路径才能构建模块依赖图。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
        >
          {loading ? "加载中…" : "刷新依赖图"}
        </button>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="按路径筛选节点…"
          className="min-w-[12rem] flex-1 text-xs border border-border rounded-md px-2 py-1 bg-background font-mono"
        />
        <div className="inline-flex rounded-md border border-border overflow-hidden text-[10px] shrink-0">
          <button
            type="button"
            onClick={() => setEngine("xyflow")}
            className={`px-2 py-1 ${engine === "xyflow" ? "bg-muted font-medium" : "bg-background"}`}
          >
            React Flow
          </button>
          <button
            type="button"
            onClick={() => setEngine("d3")}
            className={`px-2 py-1 ${engine === "d3" ? "bg-muted font-medium" : "bg-background"}`}
          >
            D3 力导向
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/15 p-2 space-y-2">
        <div className="text-[10px] font-medium text-muted-foreground">
          变更影响高亮（与上下文 Store 共享）
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 min-w-[10rem] flex-1">
            <span className="text-[10px] text-muted-foreground">变更文件路径</span>
            <input
              type="text"
              value={impactPath}
              onChange={(e) => setImpactPath(e.target.value)}
              placeholder="apps/web/src/…"
              className="text-xs border border-border rounded px-2 py-1 bg-background font-mono w-full"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">反向深度</span>
            <select
              value={hopDepth}
              onChange={(e) => setHopDepth(Number(e.target.value))}
              className="text-xs border border-border rounded px-2 py-1 bg-background"
            >
              <option value={1}>1 跳</option>
              <option value={2}>2 跳</option>
              <option value={3}>3 跳</option>
              <option value={4}>4 跳</option>
            </select>
          </label>
          <button
            type="button"
            disabled={projectId === null || impactPath.trim().length === 0 || isImpactAnalyzing}
            onClick={runImpactAnalysis}
            className="text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-50 shrink-0"
          >
            {isImpactAnalyzing ? "分析中…" : "分析并高亮"}
          </button>
        </div>
        {projectId === null ? (
          <p className="text-[10px] text-muted-foreground">
            当前无项目上下文：若在「智能上下文 → 变更影响」已分析过，上图仍会显示高亮。
          </p>
        ) : null}
        {impactHighlight !== null ? (
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span>
              <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 align-middle mr-1" />
              变更文件
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-sm bg-amber-500 align-middle mr-1" />
              直接 import 方
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-sm bg-violet-500 align-middle mr-1" />
              传递 import 方
            </span>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            尚未有变更影响结果；可输入路径后分析，或在上下文面板分析。
          </p>
        )}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        与「智能上下文 → 依赖」同源 RPC（`context.buildDependencyGraph`），此处为工作区
        <strong>全局</strong>可交互视图（最多 {GLOBAL_MAX_NODES} 个节点）；相对 import / re-export
        边，非包名解析。
      </p>
      {graph !== null && graph.nodes.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-6">未扫描到依赖节点。</p>
      ) : null}
      {graph !== null && graph.nodes.length > 0 && engine === "xyflow" ? (
        <DependencyGraphFlow
          graph={graph}
          variant="global"
          pathFilter={filter}
          maxNodes={GLOBAL_MAX_NODES}
          impactHighlight={impactHighlight}
        />
      ) : null}
      {graph !== null && graph.nodes.length > 0 && engine === "d3" ? (
        <ModuleDependencyGraphD3
          graph={graph}
          pathFilter={filter}
          maxNodes={GLOBAL_MAX_NODES}
          impactHighlight={impactHighlight}
        />
      ) : null}
    </div>
  );
}
