import { useCallback, useEffect, useMemo, useState } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime";
import type {
  ContextEntry,
  SmartSuggestion,
  DependencyGraph,
  ChangeImpact,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  useContextEntries,
  useSuggestions,
  useDependencyGraph,
  useContextLoading,
  useChangeImpact,
  useImpactAnalyzing,
  useContextStore,
} from "./contextStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { DependencyGraphFlow } from "./DependencyGraphFlow";
import { buildImpactHighlightFromChangeImpact } from "./dependencyImpactHighlight";

interface ContextPanelProps {
  projectId: ProjectId;
  workspaceRoot: string;
  session?: { threadId: ThreadId; environmentId: EnvironmentId } | null;
  className?: string;
}

export function ContextPanel({
  projectId,
  workspaceRoot,
  session = null,
  className = "",
}: ContextPanelProps) {
  const [activeTab, setActiveTab] = useState<"context" | "suggestions" | "dependencies" | "impact">(
    "context",
  );
  const [impactFocusPath, setImpactFocusPath] = useState<string | null>(null);
  const onImpactFocusPathConsumed = useCallback(() => {
    setImpactFocusPath(null);
  }, []);
  const entries = useContextEntries();
  const suggestions = useSuggestions();
  const graph = useDependencyGraph();
  const changeImpact = useChangeImpact();
  const isLoading = useContextLoading();
  const refreshContext = useContextStore((s) => s.refreshContext);

  return (
    <div className={`flex flex-col h-full bg-background ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-background">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">智能上下文</h3>
        <button
          onClick={() => void refreshContext(projectId, workspaceRoot, session ?? undefined)}
          disabled={isLoading}
          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
        >
          {isLoading ? "刷新中..." : "刷新"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-background min-h-0">
        <TabButton
          active={activeTab === "context"}
          onClick={() => setActiveTab("context")}
          label="上下文"
          count={entries.length}
        />
        <TabButton
          active={activeTab === "suggestions"}
          onClick={() => setActiveTab("suggestions")}
          label="建议"
          count={suggestions.length}
        />
        <TabButton
          active={activeTab === "dependencies"}
          onClick={() => setActiveTab("dependencies")}
          label="依赖"
          count={graph?.nodes?.length ?? 0}
        />
        <TabButton
          active={activeTab === "impact"}
          onClick={() => setActiveTab("impact")}
          label="变更影响"
          count={
            changeImpact
              ? changeImpact.affectedFiles.length + (changeImpact.transitiveImporters?.length ?? 0)
              : 0
          }
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "context" && <ContextTab entries={entries} />}
        {activeTab === "suggestions" && <SuggestionsTab session={session} />}
        {activeTab === "dependencies" && (
          <DependenciesTab
            graph={graph}
            changeImpact={changeImpact}
            onSwitchToImpact={() => setActiveTab("impact")}
            onAnalyzeFile={(path) => {
              setImpactFocusPath(path);
              setActiveTab("impact");
              void useContextStore
                .getState()
                .analyzeChangeImpact(projectId, workspaceRoot, path, 2);
            }}
          />
        )}
        {activeTab === "impact" && (
          <ImpactTab
            projectId={projectId}
            workspaceRoot={workspaceRoot}
            impact={changeImpact}
            focusPath={impactFocusPath}
            onFocusPathConsumed={onImpactFocusPathConsumed}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1 px-1 py-2 text-xs font-medium transition-colors sm:px-2 ${
        active
          ? "text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400"
          : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {count > 0 && (
        <span className="shrink-0 ml-0.5 px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-700 rounded-full">
          {count}
        </span>
      )}
    </button>
  );
}

function ContextTab({ entries }: { entries: ContextEntry[] }) {
  const groupedEntries = entries.reduce(
    (acc, entry) => {
      const type = entry.source.type;
      if (!acc[type]) acc[type] = [];
      acc[type].push(entry);
      return acc;
    },
    {} as Record<string, ContextEntry[]>,
  );

  const typeLabels: Record<string, string> = {
    file: "文件",
    "git-diff": "Git 变更",
    "todo-comment": "TODO 注释",
    "fixme-comment": "FIXME 注释",
    "architecture-decision": "架构决策",
    "core-module": "核心模块",
    "session-touch": "会话触及文件",
  };

  return (
    <div className="space-y-4">
      {Object.entries(groupedEntries).map(([type, typeEntries]) => (
        <div key={type}>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            {typeLabels[type] || type} ({typeEntries.length})
          </h4>
          <div className="space-y-1">
            {typeEntries.map((entry) => (
              <ContextEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ))}
      {entries.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          暂无上下文条目
        </div>
      )}
    </div>
  );
}

function ContextEntryCard({ entry }: { entry: ContextEntry }) {
  const isUpstreamDelta =
    entry.source.type === "git-diff" && entry.source.metadata?.branchDelta === "upstream";
  const isSessionTouch = entry.source.type === "session-touch";
  const priorityColors: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    low: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  };

  return (
    <div className="p-2 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
          {entry.source.path}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {isUpstreamDelta ? (
            <span className="text-[10px] px-1 py-0.5 rounded bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
              上游
            </span>
          ) : null}
          {isSessionTouch ? (
            <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
              回合
            </span>
          ) : null}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${priorityColors[entry.priority]}`}>
            {entry.priority}
          </span>
        </div>
      </div>
      {entry.source.content && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
          {entry.source.content}
        </p>
      )}
    </div>
  );
}

function buildSuggestionComposerPrompt(suggestion: SmartSuggestion): string {
  const paths = (suggestion.context ?? []).map((e) => e.source.path).filter((p) => p.length > 0);
  const list = paths.slice(0, 40).join("\n");

  switch (suggestion.action) {
    case "generate-commit-message":
      return `请根据当前工作区未提交的变更生成一条清晰的 Git 提交信息（中文）。主要涉及路径：\n${list || "（见上下文面板中的 Git 变更）"}`;
    case "batch-todo-process":
      return `请协助处理以下文件中的 TODO 注释，逐项完成或转化为可跟踪任务：\n${list}`;
    case "batch-fixme-process":
      return `请优先处理以下 FIXME（通常表示已知缺陷或技术债）：\n${list}`;
    case "review-upstream-delta":
      return `当前分支与上游存在以下路径差异，请说明合并/变基时可能的风险与建议复查点：\n${list}`;
    case "review-contracts-drift":
      return `当前上下文涉及 packages/contracts。请列出需同步检查的文件（RPC、WebSocket 方法、Effect Schema），并说明潜在破坏性变更：\n${list || suggestion.description}`;
    case "run-related-tests":
      return `${suggestion.title}\n\n${suggestion.description}\n\n相关路径：\n${list || suggestion.description}`;
    case "review-recent-changes":
      return `请审查近期变更并指出风险与遗漏：\n${list || suggestion.description}`;
    case "focus-core-files":
      return `${suggestion.title}\n\n${suggestion.description}`;
    default:
      return `${suggestion.title}\n\n${suggestion.description}${list ? `\n\n相关路径：\n${list}` : ""}`;
  }
}

function SuggestionsTab({
  session,
}: {
  session?: { threadId: ThreadId; environmentId: EnvironmentId } | null;
}) {
  const suggestions = useSuggestions();
  const activateSuggestion = useContextStore((s) => s.activateSuggestion);
  const activeSuggestion = useContextStore((s) => s.activeSuggestion);
  const setPrompt = useComposerDraftStore((s) => s.setPrompt);
  const getComposerDraft = useComposerDraftStore((s) => s.getComposerDraft);

  const applySuggestionToComposer = (suggestion: SmartSuggestion) => {
    const block = buildSuggestionComposerPrompt(suggestion);
    if (session) {
      const ref = scopeThreadRef(session.environmentId, session.threadId);
      const existing = getComposerDraft(ref)?.prompt?.trim() ?? "";
      const next = existing.length > 0 ? `${existing}\n\n---\n（智能上下文）\n${block}` : block;
      setPrompt(ref, next);
    } else {
      void navigator.clipboard?.writeText(block).catch(() => {
        /* ignore */
      });
    }
  };

  return (
    <div className="space-y-2">
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.id}
          onClick={() => activateSuggestion(suggestion)}
          className={`p-3 rounded-md cursor-pointer transition-colors ${
            activeSuggestion?.id === suggestion.id
              ? "bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
              : "bg-gray-50 border border-gray-200 hover:bg-gray-100 dark:bg-gray-800/50 dark:border-gray-700 dark:hover:bg-gray-700/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-gray-900 dark:text-gray-100">
              {suggestion.title}
            </h4>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                suggestion.priority === "high"
                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                  : suggestion.priority === "medium"
                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                    : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
              }`}
            >
              {suggestion.priority}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{suggestion.description}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                applySuggestionToComposer(suggestion);
              }}
              className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              {session ? "写入输入框" : "复制提示词"}
            </button>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {suggestion.action}
            </span>
          </div>
        </div>
      ))}
      {suggestions.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          暂无智能建议
        </div>
      )}
    </div>
  );
}

function ImpactTab({
  projectId,
  workspaceRoot,
  impact,
  focusPath,
  onFocusPathConsumed,
}: {
  projectId: ProjectId;
  workspaceRoot: string;
  impact: ChangeImpact | null;
  focusPath: string | null;
  onFocusPathConsumed: () => void;
}) {
  const entries = useContextEntries();
  const defaultPick = useMemo(() => {
    const worktree = entries.find(
      (e) => e.source.type === "git-diff" && e.source.metadata?.branchDelta !== "upstream",
    );
    if (worktree) {
      return worktree.source.path;
    }
    const anyGit = entries.find((e) => e.source.type === "git-diff");
    return anyGit?.source.path ?? "";
  }, [entries]);
  const [pathInput, setPathInput] = useState("");
  const [pathSeeded, setPathSeeded] = useState(false);
  const [hopDepth, setHopDepth] = useState(2);

  useEffect(() => {
    if (!focusPath || focusPath.trim().length === 0) {
      return;
    }
    setPathInput(focusPath.trim());
    setPathSeeded(true);
    onFocusPathConsumed();
  }, [focusPath, onFocusPathConsumed]);

  useEffect(() => {
    if (pathSeeded || defaultPick.length === 0) {
      return;
    }
    setPathInput(defaultPick);
    setPathSeeded(true);
  }, [defaultPick, pathSeeded]);

  const analyzeChangeImpact = useContextStore((s) => s.analyzeChangeImpact);
  const isAnalyzing = useImpactAnalyzing();

  const levelLabel: Record<ChangeImpact["impactLevel"], string> = {
    critical: "严重",
    high: "高",
    medium: "中",
    low: "低",
    none: "无",
  };

  const levelColors: Record<ChangeImpact["impactLevel"], string> = {
    critical: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
    high: "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200",
    medium: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
    low: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
    none: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 space-y-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
          变更文件（相对工作区根）
        </h4>
        <input
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 font-mono"
          placeholder="例如 apps/web/src/App.tsx"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
            反向 import 深度
          </span>
          <select
            value={hopDepth}
            onChange={(e) => setHopDepth(Number(e.target.value))}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700"
          >
            <option value={1}>仅直接</option>
            <option value={2}>2 跳（默认）</option>
            <option value={3}>3 跳</option>
            <option value={4}>4 跳</option>
          </select>
        </div>
        <button
          type="button"
          disabled={isAnalyzing || !pathInput.trim()}
          onClick={() => void analyzeChangeImpact(projectId, workspaceRoot, pathInput, hopDepth)}
          className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {isAnalyzing ? "分析中…" : "分析影响"}
        </button>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          根据 import / re-export 依赖边反向查找影响面；深度大于 1 时包含传递性 import
          方。路径需与依赖图节点一致（正斜杠）。
        </p>
      </div>

      {impact ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-medium ${levelColors[impact.impactLevel]}`}
            >
              影响等级：{levelLabel[impact.impactLevel]}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">
              {impact.changedFile}
            </span>
            {impact.impactHopDepth !== undefined ? (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                分析深度 ≤ {impact.impactHopDepth} 跳
              </span>
            ) : null}
          </div>
          {impact.riskReasons.length > 0 ? (
            <ul className="text-[10px] text-amber-800 dark:text-amber-200 list-disc pl-4 space-y-0.5">
              {impact.riskReasons.map((r, i) => (
                <li key={`${i}-${r}`}>{r}</li>
              ))}
            </ul>
          ) : null}
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              直接 import 方（{impact.affectedFiles.length}）
            </h4>
            {impact.affectedFiles.length === 0 ? (
              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                无直接导入方（或尚未构建到该路径）。
              </p>
            ) : (
              <ul className="max-h-40 overflow-auto space-y-1">
                {impact.affectedFiles.map((p) => (
                  <li
                    key={p}
                    className="text-[10px] font-mono text-gray-700 dark:text-gray-300 px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {(impact.transitiveImporters?.length ?? 0) > 0 ? (
            <div>
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                传递性 import 方（{impact.transitiveImporters?.length ?? 0}）
              </h4>
              <ul className="max-h-40 overflow-auto space-y-1">
                {(impact.transitiveImporters ?? []).map((p) => (
                  <li
                    key={p}
                    className="text-[10px] font-mono text-gray-700 dark:text-gray-300 px-2 py-1 bg-amber-50 dark:bg-amber-950/30 rounded"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
          输入路径后点击「分析影响」查看反向依赖。
        </div>
      )}
    </div>
  );
}

function DependenciesTab({
  graph,
  changeImpact,
  onSwitchToImpact,
  onAnalyzeFile,
}: {
  graph: DependencyGraph | null;
  changeImpact: ChangeImpact | null;
  onSwitchToImpact: () => void;
  onAnalyzeFile: (path: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"list" | "graph">("list");

  const impactHighlight = useMemo(
    () => buildImpactHighlightFromChangeImpact(changeImpact),
    [changeImpact],
  );

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">暂无依赖图谱</div>
    );
  }

  const q = filter.trim().toLowerCase();
  const filtered = q ? graph.nodes.filter((n) => n.path.toLowerCase().includes(q)) : graph.nodes;
  const visible = filtered.slice(0, 40);
  const focusForGraph =
    filtered.length > 0
      ? (filtered[0]?.path ?? null)
      : graph.nodes.length > 0
        ? (graph.nodes[0]?.path ?? null)
        : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>
          {graph.nodes.length} 个节点 · {graph.edges.length} 条边
          {q ? ` · 筛选 ${filtered.length} 个` : ""}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-600 overflow-hidden text-[10px]">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`px-2 py-1 ${view === "list" ? "bg-gray-200 dark:bg-gray-600" : "bg-transparent"}`}
            >
              列表
            </button>
            <button
              type="button"
              onClick={() => setView("graph")}
              className={`px-2 py-1 ${view === "graph" ? "bg-gray-200 dark:bg-gray-600" : "bg-transparent"}`}
            >
              图谱
            </button>
          </div>
          <button
            type="button"
            onClick={onSwitchToImpact}
            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            打开「变更影响」Tab
          </button>
        </div>
      </div>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="按路径筛选节点…"
        className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 font-mono"
      />
      {view === "graph" ? (
        <div className="space-y-2">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            基于当前筛选结果展示子图（可拖拽、缩放）；聚焦节点：{focusForGraph ?? "—"}
          </p>
          <DependencyGraphFlow
            graph={graph}
            focusPath={focusForGraph}
            maxNodes={56}
            impactHighlight={impactHighlight}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((node) => (
            <div
              key={node.id}
              className="p-2 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                  {node.path}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                  {node.type}
                </span>
              </div>
              {node.imports.length > 0 && (
                <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                  导入: {node.imports.length} 个模块
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onAnalyzeFile(node.path)}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                >
                  分析影响
                </button>
              </div>
            </div>
          ))}
          {filtered.length > 40 && (
            <div className="text-center text-xs text-gray-400 dark:text-gray-500">
              仅展示前 40 条，请缩小筛选范围。
            </div>
          )}
          {filtered.length === 0 && (
            <div className="text-center text-xs text-gray-400 dark:text-gray-500">无匹配节点</div>
          )}
        </div>
      )}
    </div>
  );
}
