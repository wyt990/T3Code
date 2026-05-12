import { useEffect, useState } from "react";
import type * as V from "@t3tools/contracts";
import {
  useVisualizationStore,
  useTimelineEvents,
  useHotspots,
  useOperationStats,
  useDecisionPoints,
} from "./visualizationStore";
import { ModuleDependencyGraphSection } from "./ModuleDependencyGraphSection";

interface VisualizationPanelProps {
  className?: string;
  /** When set, loads timeline/session data from the server for this thread. */
  threadId?: V.ThreadId | null;
  /** Project workspace root — required for the global module dependency graph. */
  workspaceRoot?: string;
  /** When set, enables in-panel `analyzeChangeImpact` for dependency highlighting. */
  projectId?: V.ProjectId | null;
}

const EVENT_TYPE_ICONS: Record<string, string> = {
  toolCall: "🔧",
  toolResult: "✅",
  decisionPoint: "🤔",
  fileRead: "📄",
  fileWrite: "📝",
  fileCreate: "➕",
  fileDelete: "🗑️",
  shellCommand: "💻",
  modelRequest: "🤖",
  modelResponse: "💬",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  toolCall: "工具调用",
  toolResult: "工具结果",
  decisionPoint: "决策点",
  fileRead: "文件读取",
  fileWrite: "文件写入",
  fileCreate: "文件创建",
  fileDelete: "文件删除",
  shellCommand: "Shell 命令",
  modelRequest: "模型请求",
  modelResponse: "模型响应",
};

const HOTSPOT_SEVERITY_COLORS: Record<string, string> = {
  warning:
    "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  critical:
    "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
};

const HOTSPOT_SEVERITY_LABELS: Record<string, string> = {
  warning: "⚠️ 警告",
  critical: "🚨 严重",
};

export function VisualizationPanel({
  className = "",
  threadId = null,
  workspaceRoot = "",
  projectId = null,
}: VisualizationPanelProps) {
  const [activeTab, setActiveTab] = useState<"timeline" | "hotspots" | "dependencies">("timeline");

  const hydrateFromServer = useVisualizationStore((s) => s.hydrateFromServer);
  const clearAll = useVisualizationStore((s) => s.clearAll);

  useEffect(() => {
    if (!threadId) {
      clearAll();
      return;
    }
    void hydrateFromServer(threadId);
  }, [threadId, hydrateFromServer, clearAll]);

  const currentSession = useVisualizationStore((s) => s.sessionData);
  const events = useTimelineEvents();
  const hotspots = useHotspots();
  const operationStats = useOperationStats();
  const decisionPoints = useDecisionPoints();
  const toggleTimeline = useVisualizationStore((s) => s.toggleTimeline);

  const hasSession = currentSession !== null;
  const hasWorkspace = workspaceRoot.trim().length > 0;

  if (!hasSession && !hasWorkspace) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">可视化调试</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-sm text-gray-500 dark:text-gray-400">
            打开带项目的会话后可查看执行时间线与工作区模块依赖图。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">可视化调试</h3>
        <div className="flex items-center gap-2">
          {hasSession ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">{events.length} 事件</span>
          ) : (
            <span className="text-xs text-gray-500 dark:text-gray-400">无会话遥测</span>
          )}
        </div>
      </div>

      {hasSession ? (
        <div className="grid grid-cols-4 gap-1 p-2 border-b border-gray-200 dark:border-gray-700">
          <StatBadge count={events.length} label="事件" color="blue" />
          <StatBadge count={hotspots.length} label="热点" color="yellow" />
          <StatBadge count={decisionPoints.length} label="决策" color="purple" />
          <StatBadge count={operationStats.length} label="操作类型" color="green" />
        </div>
      ) : (
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400">
          尚未加载本会话的执行可视化数据；「时间线 / 热点」为空属正常。可在「依赖」Tab
          查看工作区模块图。
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          {hasSession ? (
            <button
              type="button"
              onClick={toggleTimeline}
              className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {activeTab === "timeline" ? "收起" : "展开"} 时间线
            </button>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={activeTab === "hotspots"}
              onChange={() => setActiveTab("hotspots")}
              className="rounded"
            />
            热点
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={activeTab === "dependencies"}
              onChange={() => setActiveTab("dependencies")}
              className="rounded"
            />
            依赖
          </label>
        </div>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <TabButton
          active={activeTab === "timeline"}
          onClick={() => setActiveTab("timeline")}
          label="时间线"
        />
        <TabButton
          active={activeTab === "hotspots"}
          onClick={() => setActiveTab("hotspots")}
          label="热点"
        />
        <TabButton
          active={activeTab === "dependencies"}
          onClick={() => setActiveTab("dependencies")}
          label="依赖"
        />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === "timeline" &&
          (hasSession ? (
            <TimelineTab events={events} />
          ) : (
            <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
              无执行会话数据。请确认可视化服务已记录该线程，或稍后在有遥测时再试。
            </div>
          ))}
        {activeTab === "hotspots" &&
          (hasSession ? (
            <HotspotsTab hotspots={hotspots} />
          ) : (
            <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
              无会话热点数据
            </div>
          ))}
        {activeTab === "dependencies" && (
          <DependenciesTab workspaceRoot={workspaceRoot} projectId={projectId} />
        )}
      </div>
    </div>
  );
}

function StatBadge({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: "blue" | "yellow" | "purple" | "green";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    yellow: "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400",
    purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
    green: "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400",
  };

  return (
    <div className={`text-center py-2 rounded ${colorClasses[color]}`}>
      <div className="text-lg font-semibold">{count}</div>
      <div className="text-[10px]">{label}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400"
          : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      }`}
    >
      {label}
    </button>
  );
}

function TimelineTab({ events }: { events: readonly V.ExecutionEvent[] }) {
  return (
    <div className="space-y-2">
      {events.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">暂无事件</div>
      ) : (
        events.map((event) => <EventCard key={event.id} event={event} />)
      )}
    </div>
  );
}

function EventCard({ event }: { event: V.ExecutionEvent }) {
  return (
    <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{EVENT_TYPE_ICONS[event.eventType] || "📌"}</span>
          <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
            {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
          </span>
        </div>
        {event.durationMs !== undefined && event.durationMs !== null ? (
          <span className="text-[10px] text-gray-500 dark:text-gray-400">{event.durationMs}ms</span>
        ) : null}
      </div>
      {event.category ? (
        <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2">
          {event.category}
        </p>
      ) : null}
      <div className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
        {new Date(event.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

function HotspotsTab({ hotspots }: { hotspots: readonly V.PerformanceHotspot[] }) {
  return (
    <div className="space-y-2">
      {hotspots.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">无性能热点</div>
      ) : (
        hotspots.map((hotspot) => <HotspotCard key={hotspot.id} hotspot={hotspot} />)
      )}
    </div>
  );
}

function HotspotCard({ hotspot }: { hotspot: V.PerformanceHotspot }) {
  return (
    <div className={`p-3 rounded-md border ${HOTSPOT_SEVERITY_COLORS[hotspot.severity]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
          {HOTSPOT_SEVERITY_LABELS[hotspot.severity]}
        </span>
        <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
          {hotspot.durationMs}ms
        </span>
      </div>
      <div className="mt-2 text-[10px] text-gray-700 dark:text-gray-300">{hotspot.eventType}</div>
      {hotspot.recommendation ? (
        <div className="mt-1 text-[10px] text-gray-600 dark:text-gray-400">
          💡 {hotspot.recommendation}
        </div>
      ) : null}
    </div>
  );
}

function DependenciesTab({
  workspaceRoot,
  projectId,
}: {
  workspaceRoot: string;
  projectId: V.ProjectId | null;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
        全局模块依赖（React Flow / D3）
      </h4>
      <ModuleDependencyGraphSection workspaceRoot={workspaceRoot} projectId={projectId} />
      <p className="text-[10px] text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
        详细列表与单文件跳转仍可在「智能上下文 → 变更影响」查看；此处将同一分析结果叠加在依赖图上。
      </p>
    </div>
  );
}
