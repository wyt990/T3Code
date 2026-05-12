import type {
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";

import {
  useMultiAgentStore,
  useAgents,
  useTasks,
  useTasksByAgent,
  usePendingTasks,
  useInProgressTasks,
  useCompletedTasks,
  useSharedContext,
  useRoleTemplates,
  type AgentRole,
  type AgentConfig,
  type AgentTask,
  type SubmitTaskInput,
} from "./multiAgentStore";

export interface MultiAgentPanelProps {
  readonly className?: string | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly threadId?: ThreadId | null | undefined;
  readonly modelSelection?: ModelSelection | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly interactionMode?: ProviderInteractionMode | undefined;
}

const ROLE_ICONS: Record<AgentRole, string> = {
  architect: "🏗️",
  coder: "💻",
  reviewer: "👁️",
  tester: "🧪",
  "doc-writer": "📝",
  custom: "🤖",
};

const ROLE_LABELS: Record<AgentRole, string> = {
  architect: "架构师",
  coder: "编码者",
  reviewer: "审查者",
  tester: "测试者",
  "doc-writer": "文档编写",
  custom: "自定义",
};

const STATUS_LABELS: Record<AgentTask["status"], string> = {
  pending: "等待中",
  "in-progress": "进行中",
  completed: "已完成",
  failed: "失败",
};

const STATUS_COLORS: Record<AgentTask["status"], string> = {
  pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  "in-progress": "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

export function MultiAgentPanel(props: MultiAgentPanelProps) {
  const {
    className = "",
    projectId,
    threadId,
    modelSelection,
    runtimeMode,
    interactionMode,
  } = props;
  const [activeTab, setActiveTab] = useState<"agents" | "tasks" | "context" | "templates">(
    "agents",
  );
  const agents = useAgents();
  const tasks = useTasks();
  const pendingTasks = usePendingTasks();
  const inProgressTasks = useInProgressTasks();
  const completedTasks = useCompletedTasks();
  const sharedContext = useSharedContext();
  const roleTemplates = useRoleTemplates();
  const selectedAgentId = useMultiAgentStore((s) => s.selectedAgentId);
  const selectAgent = useMultiAgentStore((s) => s.selectAgent);
  const addAgent = useMultiAgentStore((s) => s.addAgent);
  const submitTask = useMultiAgentStore((s) => s.submitTask);

  const canAttachProvider = Boolean(
    projectId !== undefined &&
    threadId !== null &&
    threadId !== undefined &&
    modelSelection !== undefined,
  );

  const handleAddAgent = () => {
    const roles: AgentRole[] = ["architect", "coder", "reviewer", "tester", "doc-writer"];
    const randomIndex = Math.floor(Math.random() * roles.length);
    const randomRole = roles[randomIndex];
    if (randomRole) {
      void addAgent({
        role: randomRole,
        name: `${ROLE_LABELS[randomRole]}-${agents.length + 1}`,
        capabilities: [],
        maxConcurrentTasks: 3,
      });
    }
  };

  const handleAddFromTemplate = (templateId: string) => {
    const t = roleTemplates.find((x) => x.id === templateId);
    if (!t) {
      return;
    }
    void addAgent({
      role: t.role as AgentRole,
      name: `${t.name}-${agents.length + 1}`,
      capabilities: [t.instructions.slice(0, 120)],
      maxConcurrentTasks: 3,
    });
  };

  const handleSubmitTask = (agentId: string) => {
    const next: SubmitTaskInput = {
      agentId,
      role: "coder",
      title: `新任务 ${tasks.length + 1}`,
      description: "待处理的任务",
      dependencies: [],
      payload: {},
    };
    if (canAttachProvider && projectId !== undefined && threadId && modelSelection !== undefined) {
      next.providerDispatch = {
        projectId,
        threadId,
        modelSelection,
        ...(runtimeMode !== undefined ? { runtimeMode } : {}),
        ...(interactionMode !== undefined ? { interactionMode } : {}),
      };
    }
    void submitTask(next);
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">多代理协同</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">{agents.length} 代理</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{tasks.length} 任务</span>
        </div>
      </div>

      {canAttachProvider ? (
        <p className="px-4 py-1.5 text-[10px] text-muted-foreground border-b border-gray-200 dark:border-gray-700">
          新任务将附带「当前会话」Provider 派发；启动任务后会向该会话发送回合。
        </p>
      ) : (
        <p className="px-4 py-1.5 text-[10px] text-amber-700/90 dark:text-amber-400 border-b border-gray-200 dark:border-gray-700">
          未绑定会话：任务仅记录在编排器内。请打开项目下的线程后再试。
        </p>
      )}

      <div className="grid grid-cols-4 gap-1 p-2 border-b border-gray-200 dark:border-gray-700">
        <StatBadge count={agents.length} label="代理" color="blue" />
        <StatBadge count={pendingTasks.length} label="等待" color="gray" />
        <StatBadge count={inProgressTasks.length} label="进行中" color="yellow" />
        <StatBadge count={completedTasks.length} label="完成" color="green" />
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <TabButton
          active={activeTab === "agents"}
          onClick={() => setActiveTab("agents")}
          label="代理"
        />
        <TabButton
          active={activeTab === "tasks"}
          onClick={() => setActiveTab("tasks")}
          label="任务"
        />
        <TabButton
          active={activeTab === "context"}
          onClick={() => setActiveTab("context")}
          label="上下文"
        />
        <TabButton
          active={activeTab === "templates"}
          onClick={() => setActiveTab("templates")}
          label="角色模板"
        />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === "agents" && (
          <AgentsTab
            agents={agents}
            roleTemplates={roleTemplates}
            selectedAgentId={selectedAgentId}
            onSelectAgent={selectAgent}
            onAddAgent={handleAddAgent}
            onAddFromTemplate={handleAddFromTemplate}
            onSubmitTask={handleSubmitTask}
          />
        )}
        {activeTab === "tasks" && (
          <TasksTab
            tasks={tasks}
            canAttachProvider={canAttachProvider}
            projectId={projectId}
            threadId={threadId ?? null}
            modelSelection={modelSelection}
            runtimeMode={runtimeMode}
            interactionMode={interactionMode}
          />
        )}
        {activeTab === "context" && <ContextTab context={sharedContext} />}
        {activeTab === "templates" && <TemplatesTab />}
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
  color: "blue" | "gray" | "yellow" | "green";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    gray: "bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    yellow: "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400",
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

function AgentsTab({
  agents,
  roleTemplates,
  selectedAgentId,
  onSelectAgent,
  onAddAgent,
  onAddFromTemplate,
  onSubmitTask,
}: {
  agents: AgentConfig[];
  roleTemplates: { id: string; name: string }[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  onAddAgent: () => void;
  onAddFromTemplate: (templateId: string) => void;
  onSubmitTask: (agentId: string) => void;
}) {
  const removeAgent = useMultiAgentStore((s) => s.removeAgent);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">已注册代理</h4>
        <div className="flex flex-wrap gap-2 items-center">
          {roleTemplates.length > 0 && (
            <select
              className="text-[10px] border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 max-w-[140px]"
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) {
                  onAddFromTemplate(v);
                  e.target.selectedIndex = 0;
                }
              }}
            >
              <option value="">从模板添加…</option>
              {roleTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={onAddAgent}
            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            + 随机代理
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {agents.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
            暂无代理，请从模板或随机添加
          </div>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={agent.id === selectedAgentId}
              onSelect={() => onSelectAgent(agent.id)}
              onRemove={() => void removeAgent(agent.id)}
              onSubmitTask={() => onSubmitTask(agent.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  isSelected,
  onSelect,
  onRemove,
  onSubmitTask,
}: {
  agent: AgentConfig;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onSubmitTask: () => void;
}) {
  const agentTasks = useTasksByAgent(agent.id);
  const activeTasks = agentTasks.filter((t) => t.status === "in-progress").length;

  return (
    <div
      className={`p-3 rounded-md cursor-pointer transition-colors ${
        isSelected
          ? "bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
          : "bg-gray-50 border border-gray-200 hover:bg-gray-100 dark:bg-gray-800/50 dark:border-gray-700 dark:hover:bg-gray-700/50"
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">{ROLE_ICONS[agent.role]}</span>
          <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
            {agent.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSubmitTask();
            }}
            className="text-[10px] px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            分配任务
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="text-[10px] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
          >
            移除
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
        <span>{ROLE_LABELS[agent.role]}</span>
        <span>
          {activeTasks}/{agent.maxConcurrentTasks} 进行中
        </span>
      </div>
      {agentTasks.length > 0 && (
        <div className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
          总任务: {agentTasks.length}
        </div>
      )}
    </div>
  );
}

function TasksTab({
  tasks,
  canAttachProvider,
  projectId,
  threadId,
  modelSelection,
  runtimeMode,
  interactionMode,
}: {
  tasks: AgentTask[];
  canAttachProvider: boolean;
  projectId: ProjectId | undefined;
  threadId: ThreadId | null;
  modelSelection: ModelSelection | undefined;
  runtimeMode: RuntimeMode | undefined;
  interactionMode: ProviderInteractionMode | undefined;
}) {
  const [filter, setFilter] = useState<AgentTask["status"] | "all">("all");
  const agents = useAgents();
  const submitTask = useMultiAgentStore((s) => s.submitTask);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [depsRaw, setDepsRaw] = useState("");
  const [agentId, setAgentId] = useState<string>("");

  const filteredTasks = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

  const parseDeps = (raw: string): string[] =>
    raw
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3 space-y-2 bg-gray-50/50 dark:bg-gray-900/20">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">新建任务</h4>
        <input
          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
          placeholder="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 min-h-[48px]"
          placeholder="描述（可选）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
          placeholder="依赖任务 ID（逗号分隔，可选）"
          value={depsRaw}
          onChange={(e) => setDepsRaw(e.target.value)}
        />
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
            value={agentId || agents[0]?.id || ""}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!title.trim() || agents.length === 0}
            className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-40"
            onClick={() => {
              const aid = agentId || agents[0]?.id;
              if (!aid || !title.trim()) {
                return;
              }
              const providerDispatch =
                canAttachProvider && projectId !== undefined && threadId && modelSelection
                  ? {
                      projectId,
                      threadId,
                      modelSelection,
                      ...(runtimeMode !== undefined ? { runtimeMode } : {}),
                      ...(interactionMode !== undefined ? { interactionMode } : {}),
                    }
                  : undefined;
              const next: SubmitTaskInput = {
                agentId: aid,
                role: "coder",
                title: title.trim(),
                dependencies: parseDeps(depsRaw),
                payload: {},
              };
              const d = description.trim();
              if (d !== "") {
                next.description = d;
              }
              if (providerDispatch !== undefined) {
                next.providerDispatch = providerDispatch;
              }
              void submitTask(next);
              setTitle("");
              setDescription("");
              setDepsRaw("");
            }}
          >
            提交到队列
          </button>
        </div>
        <p className="text-[10px] text-gray-500">
          若需向当前会话派发
          Provider，请在「代理」页用「分配任务」或先绑定会话后创建任务（工作台已打开线程时会自动附带）。
        </p>
      </div>

      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">任务队列</h4>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as AgentTask["status"] | "all")}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
        >
          <option value="all">全部</option>
          <option value="pending">等待中</option>
          <option value="in-progress">进行中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
        </select>
      </div>

      <div className="space-y-2">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">暂无任务</div>
        ) : (
          filteredTasks.map((task) => <TaskCard key={task.id} task={task} allTasks={tasks} />)
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, allTasks }: { task: AgentTask; allTasks: AgentTask[] }) {
  const startTaskOnServer = useMultiAgentStore((s) => s.startTaskOnServer);
  const completeTask = useMultiAgentStore((s) => s.completeTask);
  const failTask = useMultiAgentStore((s) => s.failTask);
  const [dispatchHint, setDispatchHint] = useState<string | null>(null);

  const depsSatisfied = task.dependencies.every((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    return dep?.status === "completed";
  });

  const hasProviderDispatch =
    typeof task.payload === "object" &&
    task.payload !== null &&
    "providerDispatch" in task.payload &&
    (task.payload as { providerDispatch?: unknown }).providerDispatch !== undefined;

  return (
    <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{task.title}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${STATUS_COLORS[task.status]}`}
        >
          {STATUS_LABELS[task.status]}
        </span>
      </div>
      {task.description && (
        <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2">
          {task.description}
        </p>
      )}
      {task.dependencies.length > 0 && (
        <p className="mt-1 text-[10px] text-gray-500">
          依赖: {task.dependencies.join(", ")} {depsSatisfied ? "✓" : "（未完成）"}
        </p>
      )}
      {hasProviderDispatch && (
        <p className="mt-1 text-[10px] text-blue-600 dark:text-blue-400">
          已绑定 Provider 会话派发
        </p>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500">
        <span>{ROLE_LABELS[task.role]}</span>
        <span>{new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
      {task.status === "in-progress" && (
        <div className="mt-2">
          <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full">
            <div
              className="h-1 bg-blue-600 rounded-full transition-all"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}
      {dispatchHint !== null && (
        <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-400">{dispatchHint}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {task.status === "pending" && (
          <button
            type="button"
            disabled={!depsSatisfied}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-40"
            onClick={async () => {
              setDispatchHint(null);
              const r = await startTaskOnServer(task.id);
              if (r?.providerDispatchError) {
                setDispatchHint(`派发: ${r.providerDispatchError}`);
              } else if (r?.providerDispatched === false && hasProviderDispatch) {
                setDispatchHint("派发未执行（校验未通过或负载拒绝）");
              }
            }}
          >
            启动
          </button>
        )}
        {task.status === "in-progress" && (
          <>
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600"
              onClick={() => void completeTask(task.id, { manual: true })}
            >
              标为完成
            </button>
            <button
              type="button"
              className="text-[10px] px-2 py-0.5 rounded border border-red-300 text-red-700 dark:text-red-400"
              onClick={() => void failTask(task.id, "manual_fail")}
            >
              标为失败
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ContextTab({
  context,
}: {
  context: { key: string; value: unknown; updatedAt: string; updatedBy: string }[];
}) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">共享上下文</h4>

      <div className="space-y-2">
        {context.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
            暂无共享上下文
          </div>
        ) : (
          context.map((item) => (
            <div
              key={item.key}
              className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                  {item.key}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {item.updatedBy}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                {JSON.stringify(item.value).slice(0, 100)}
                {JSON.stringify(item.value).length > 100 ? "..." : ""}
              </div>
              <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                {new Date(item.updatedAt).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TemplatesTab() {
  const roleTemplates = useRoleTemplates();
  const upsertRoleTemplate = useMultiAgentStore((s) => s.upsertRoleTemplate);
  const deleteRoleTemplate = useMultiAgentStore((s) => s.deleteRoleTemplate);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AgentRole>("custom");
  const [instructions, setInstructions] = useState("");

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">自定义模板</h4>
        <p className="text-[10px] text-gray-500">
          预设模板以 <code className="text-[10px]">preset:</code> 开头，不可删除；自定义请使用其它
          ID。
        </p>
        <input
          className="w-full text-xs border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
          placeholder="模板 ID（唯一）"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="w-full text-xs border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
          placeholder="显示名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="w-full text-xs border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
          value={role}
          onChange={(e) => setRole(e.target.value as AgentRole)}
        >
          {(Object.keys(ROLE_LABELS) as AgentRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <textarea
          className="w-full text-xs border rounded px-2 py-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 min-h-[72px]"
          placeholder="系统/角色说明（写入代理 capabilities 摘要或人工参考）"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <button
          type="button"
          className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-40"
          disabled={!id.trim() || !name.trim()}
          onClick={() =>
            void upsertRoleTemplate({
              id: id.trim(),
              name: name.trim(),
              role,
              instructions: instructions.trim() || " ",
            })
          }
        >
          保存模板
        </button>
      </div>

      <div className="space-y-2">
        {roleTemplates.map((t) => (
          <div
            key={t.id}
            className="p-2 rounded border border-gray-200 dark:border-gray-700 text-[10px] flex justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{t.name}</div>
              <div className="text-gray-500 truncate">{t.id}</div>
            </div>
            {!t.id.startsWith("preset:") && (
              <button
                type="button"
                className="shrink-0 text-red-600 dark:text-red-400"
                onClick={() => void deleteRoleTemplate(t.id)}
              >
                删除
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
