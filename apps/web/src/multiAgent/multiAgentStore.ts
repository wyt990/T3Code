import type {
  MultiAgentConfig,
  MultiAgentProviderDispatch,
  MultiAgentRoleTemplate,
  MultiAgentRoleTemplateUpsert,
  MultiAgentTask as ServerAgentTask,
} from "@t3tools/contracts";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { readPrimaryWsRpcClient } from "../rpc/wsClientHelpers";

export type AgentRole = "architect" | "coder" | "reviewer" | "tester" | "doc-writer" | "custom";

export interface AgentConfig {
  id: string;
  role: AgentRole;
  name: string;
  capabilities: string[];
  maxConcurrentTasks: number;
  avatar?: string;
}

export interface AgentTask {
  id: string;
  agentId: string;
  role: AgentRole;
  title: string;
  description?: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  dependencies: string[];
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
  progress: number;
}

export type SubmitTaskInput = Omit<
  AgentTask,
  "id" | "status" | "createdAt" | "updatedAt" | "progress"
> & {
  providerDispatch?: MultiAgentProviderDispatch | undefined;
};

function serverAgentToUi(agent: MultiAgentConfig): AgentConfig {
  return {
    id: agent.id,
    role: agent.role as AgentRole,
    name: agent.name,
    capabilities: [...agent.capabilities],
    maxConcurrentTasks: agent.maxConcurrentTasks,
  };
}

function serverTaskToUi(
  task: ServerAgentTask,
  titleFallback: string,
  description?: string,
): AgentTask {
  const payload = task.payload as { title?: string; description?: string } | undefined;
  const title = payload?.title ?? titleFallback;
  const desc = payload?.description ?? description;
  const progress =
    task.status === "completed"
      ? 100
      : task.status === "in-progress"
        ? 50
        : task.status === "failed"
          ? 0
          : 0;
  return {
    id: task.id,
    agentId: task.agentId,
    role: task.role,
    title,
    ...(desc !== undefined ? { description: desc } : {}),
    status: task.status,
    dependencies: [...task.dependencies],
    payload: task.payload,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.result !== undefined ? { result: task.result } : {}),
    ...(task.error !== undefined ? { error: task.error } : {}),
    progress,
  };
}

export interface SharedContextItem {
  key: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string;
}

interface MultiAgentState {
  readonly agents: AgentConfig[];
  readonly selectedAgentId: string | null;
  readonly tasks: AgentTask[];
  readonly selectedTaskId: string | null;
  readonly sharedContext: SharedContextItem[];
  readonly roleTemplates: MultiAgentRoleTemplate[];
  readonly isAgentsLoading: boolean;
  readonly isTasksLoading: boolean;

  readonly setAgents: (agents: AgentConfig[]) => void;
  readonly selectAgent: (agentId: string | null) => void;
  readonly setTasks: (tasks: AgentTask[]) => void;
  readonly selectTask: (taskId: string | null) => void;
  readonly addAgent: (agent: Omit<AgentConfig, "id">) => Promise<void>;
  readonly removeAgent: (agentId: string) => Promise<void>;
  readonly submitTask: (task: SubmitTaskInput) => Promise<void>;
  readonly updateTaskStatus: (
    taskId: string,
    status: AgentTask["status"],
    progress?: number,
  ) => void;
  readonly completeTask: (taskId: string, result?: unknown) => Promise<void>;
  readonly failTask: (taskId: string, error: string) => Promise<void>;
  readonly startTaskOnServer: (taskId: string) => Promise<{
    readonly started: boolean;
    readonly providerDispatched?: boolean | undefined;
    readonly providerDispatchError?: string | undefined;
  } | null>;
  readonly setSharedContext: (key: string, value: unknown, updatedBy: string) => void;
  readonly getSharedContext: (key: string) => SharedContextItem | undefined;
  readonly hydrateFromServer: () => Promise<void>;
  readonly upsertRoleTemplate: (input: MultiAgentRoleTemplateUpsert) => Promise<void>;
  readonly deleteRoleTemplate: (id: string) => Promise<void>;
}

export const useMultiAgentStore = create<MultiAgentState>((set, get) => ({
  agents: [],
  selectedAgentId: null,
  tasks: [],
  selectedTaskId: null,
  sharedContext: [],
  roleTemplates: [],
  isAgentsLoading: false,
  isTasksLoading: false,

  setAgents: (agents) => set({ agents }),
  selectAgent: (agentId) => set({ selectedAgentId: agentId }),
  setTasks: (tasks) => set({ tasks }),
  selectTask: (taskId) => set({ selectedTaskId: taskId }),

  addAgent: async (agent) => {
    const newAgent: AgentConfig = {
      ...agent,
      id: `agent-${Date.now()}`,
    };
    const client = readPrimaryWsRpcClient();
    if (client) {
      try {
        await client.multiAgent.registerAgent(newAgent);
      } catch (error) {
        console.error("multiAgent.registerAgent failed:", error);
      }
    }
    set((state) => ({
      agents: [...state.agents, newAgent],
    }));
  },

  removeAgent: async (agentId) => {
    const client = readPrimaryWsRpcClient();
    if (client) {
      try {
        await client.multiAgent.unregisterAgent({ agentId });
      } catch (error) {
        console.error("multiAgent.unregisterAgent failed:", error);
      }
    }
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== agentId),
      tasks: state.tasks.filter((t) => t.agentId !== agentId),
    }));
  },

  submitTask: async (task) => {
    const taskId = `task-${Date.now()}`;
    const now = new Date().toISOString();
    const payload = {
      ...(typeof task.payload === "object" && task.payload !== null ? task.payload : {}),
      title: task.title,
      description: task.description,
      ...(task.providerDispatch !== undefined ? { providerDispatch: task.providerDispatch } : {}),
    };
    const client = readPrimaryWsRpcClient();
    if (client) {
      try {
        const created = await client.multiAgent.submitTask({
          id: taskId,
          agentId: task.agentId,
          role: task.role,
          dependencies: [...task.dependencies],
          payload,
        });
        const mapped = serverTaskToUi(created, task.title, task.description);
        set((state) => ({
          tasks: [...state.tasks, mapped],
        }));
        return;
      } catch (error) {
        console.error("multiAgent.submitTask failed:", error);
      }
    }

    const newTask: AgentTask = {
      ...task,
      id: taskId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      progress: 0,
    };
    set((state) => ({
      tasks: [...state.tasks, newTask],
    }));
  },

  updateTaskStatus: (taskId, status, progress) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status, progress: progress ?? t.progress, updatedAt: new Date().toISOString() }
          : t,
      ),
    }));
  },

  completeTask: async (taskId, result) => {
    const client = readPrimaryWsRpcClient();
    if (client) {
      try {
        await client.multiAgent.completeTask({ taskId, result });
      } catch (error) {
        console.error("multiAgent.completeTask failed:", error);
      }
    }
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: "completed" as const,
              result,
              progress: 100,
              updatedAt: new Date().toISOString(),
            }
          : t,
      ),
    }));
  },

  failTask: async (taskId, error) => {
    const client = readPrimaryWsRpcClient();
    if (client) {
      try {
        await client.multiAgent.failTask({ taskId, error });
      } catch (e) {
        console.error("multiAgent.failTask failed:", e);
      }
    }
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: "failed" as const, error, updatedAt: new Date().toISOString() }
          : t,
      ),
    }));
  },

  startTaskOnServer: async (taskId) => {
    const client = readPrimaryWsRpcClient();
    if (!client) {
      return null;
    }
    const out = await client.multiAgent.startTask({ taskId });
    if (out.started) {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: "in-progress" as const,
                progress: 50,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      }));
    }
    return out;
  },

  setSharedContext: (key, value, updatedBy) => {
    const client = readPrimaryWsRpcClient();
    if (client) {
      void client.multiAgent.setSharedContext({ key, value }).catch((error) => {
        console.error("multiAgent.setSharedContext failed:", error);
      });
    }
    set((state) => {
      const existingIndex = state.sharedContext.findIndex((item) => item.key === key);
      const newItem: SharedContextItem = {
        key,
        value,
        updatedAt: new Date().toISOString(),
        updatedBy,
      };

      if (existingIndex >= 0) {
        const newContext = [...state.sharedContext];
        newContext[existingIndex] = newItem;
        return { sharedContext: newContext };
      }
      return { sharedContext: [...state.sharedContext, newItem] };
    });
  },

  getSharedContext: (key) => {
    return get().sharedContext.find((item) => item.key === key);
  },

  upsertRoleTemplate: async (input) => {
    const client = readPrimaryWsRpcClient();
    if (!client) {
      return;
    }
    try {
      await client.multiAgent.upsertRoleTemplate(input);
      await get().hydrateFromServer();
    } catch (error) {
      console.error("multiAgent.upsertRoleTemplate failed:", error);
    }
  },

  deleteRoleTemplate: async (id) => {
    const client = readPrimaryWsRpcClient();
    if (!client) {
      return;
    }
    try {
      await client.multiAgent.deleteRoleTemplate({ id });
      await get().hydrateFromServer();
    } catch (error) {
      console.error("multiAgent.deleteRoleTemplate failed:", error);
    }
  },

  hydrateFromServer: async () => {
    const client = readPrimaryWsRpcClient();
    if (!client) {
      return;
    }
    try {
      const [agentsRes, tasksRes, shared, templatesRes] = await Promise.all([
        client.multiAgent.listAgents(),
        client.multiAgent.listTasks({}),
        client.multiAgent.getAllSharedContext(),
        client.multiAgent.listRoleTemplates(),
      ]);
      const mappedTasks = tasksRes.tasks.map((t) =>
        serverTaskToUi(
          t,
          (t.payload as { title?: string } | undefined)?.title ?? t.id,
          (t.payload as { description?: string } | undefined)?.description,
        ),
      );
      const sharedContext: SharedContextItem[] = Object.entries(shared.context).map(([k, v]) => ({
        key: k,
        value: v,
        updatedAt: new Date().toISOString(),
        updatedBy: "server",
      }));
      set({
        agents: agentsRes.agents.map(serverAgentToUi),
        tasks: mappedTasks,
        sharedContext,
        roleTemplates: [...templatesRes.templates],
      });
    } catch (error) {
      console.error("multiAgent.hydrateFromServer failed:", error);
    }
  },
}));

export const useAgents = () => useMultiAgentStore((s) => s.agents);
export const useSelectedAgent = () =>
  useMultiAgentStore((s) => s.agents.find((a) => a.id === s.selectedAgentId));
export const useTasks = () => useMultiAgentStore((s) => s.tasks);
export const useTasksByAgent = (agentId: string) =>
  useMultiAgentStore(useShallow((s) => s.tasks.filter((t) => t.agentId === agentId)));
export const useTasksByStatus = (status: AgentTask["status"]) =>
  useMultiAgentStore(useShallow((s) => s.tasks.filter((t) => t.status === status)));
export const usePendingTasks = () =>
  useMultiAgentStore(useShallow((s) => s.tasks.filter((t) => t.status === "pending")));
export const useInProgressTasks = () =>
  useMultiAgentStore(useShallow((s) => s.tasks.filter((t) => t.status === "in-progress")));
export const useCompletedTasks = () =>
  useMultiAgentStore(useShallow((s) => s.tasks.filter((t) => t.status === "completed")));
export const useSharedContext = () => useMultiAgentStore((s) => s.sharedContext);
export const useRoleTemplates = () => useMultiAgentStore((s) => s.roleTemplates);
