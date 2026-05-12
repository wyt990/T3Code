import { Effect, Layer, Ref } from "effect";
import {
  MultiAgentOrchestrator,
  type Task,
  type TaskStatus,
} from "../Services/MultiAgentOrchestrator.ts";

// Agent role definitions
export type AgentRole = "architect" | "coder" | "reviewer" | "tester" | "doc-writer" | "custom";

export interface AgentConfig {
  id: string;
  role: AgentRole;
  name: string;
  capabilities: string[];
  maxConcurrentTasks: number;
}

export interface AgentTask {
  id: string;
  agentId: string;
  role: AgentRole;
  status: "pending" | "in-progress" | "completed" | "failed";
  dependencies: string[];
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
}

export const makeMultiAgentOrchestrator = Effect.gen(function* () {
  const agentsRef = yield* Ref.make<Map<string, AgentConfig>>(new Map());
  const tasksRef = yield* Ref.make<Map<string, AgentTask>>(new Map());
  const sharedContextRef = yield* Ref.make<Map<string, unknown>>(new Map());

  const registerAgent = Effect.fn("MultiAgentOrchestrator.registerAgent")(function* (
    config: AgentConfig,
  ) {
    yield* Ref.update(agentsRef, (agents) => {
      const newAgents = new Map(agents);
      newAgents.set(config.id, config);
      return newAgents;
    });
    yield* Effect.log(`[MultiAgent] Registered agent: ${config.name} (${config.role})`);
  });

  const unregisterAgent = Effect.fn("MultiAgentOrchestrator.unregisterAgent")(function* (
    agentId: string,
  ) {
    yield* Ref.update(agentsRef, (agents) => {
      const newAgents = new Map(agents);
      newAgents.delete(agentId);
      return newAgents;
    });
    yield* Effect.log(`[MultiAgent] Unregistered agent: ${agentId}`);
  });

  const submitTask = Effect.fn("MultiAgentOrchestrator.submitTask")(function* (
    task: Omit<AgentTask, "status" | "createdAt" | "updatedAt">,
  ) {
    const now = new Date().toISOString();
    const fullTask: AgentTask = {
      ...task,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    yield* Ref.update(tasksRef, (tasks) => {
      const newTasks = new Map(tasks);
      newTasks.set(task.id, fullTask);
      return newTasks;
    });

    yield* Effect.log(`[MultiAgent] Task submitted: ${task.id} for agent ${task.agentId}`);
    return fullTask;
  });

  const startTask = Effect.fn("MultiAgentOrchestrator.startTask")(function* (taskId: string) {
    const tasksBefore = yield* Ref.get(tasksRef);
    const task = tasksBefore.get(taskId);
    if (!task) {
      yield* Effect.log(`[MultiAgent] startTask: unknown task ${taskId}`);
      return false;
    }
    const depsSatisfied = yield* checkDependencies(taskId);
    if (!depsSatisfied) {
      yield* Effect.log(
        `[MultiAgent] startTask blocked (dependencies): ${taskId} deps=${task.dependencies.join(",")}`,
      );
      return false;
    }
    yield* Ref.update(tasksRef, (tasks) => {
      const current = tasks.get(taskId);
      if (current) {
        const newTasks = new Map(tasks);
        newTasks.set(taskId, {
          ...current,
          status: "in-progress",
          updatedAt: new Date().toISOString(),
        });
        return newTasks;
      }
      return tasks;
    });
    yield* Effect.log(`[MultiAgent] Task started: ${taskId}`);
    return true;
  });

  const completeTask = Effect.fn("MultiAgentOrchestrator.completeTask")(function* (
    taskId: string,
    result: unknown,
  ) {
    yield* Ref.update(tasksRef, (tasks) => {
      const task = tasks.get(taskId);
      if (task) {
        const newTasks = new Map(tasks);
        newTasks.set(taskId, {
          ...task,
          status: "completed",
          result,
          updatedAt: new Date().toISOString(),
        });
        return newTasks;
      }
      return tasks;
    });
    yield* Effect.log(`[MultiAgent] Task completed: ${taskId}`);
  });

  const failTask = Effect.fn("MultiAgentOrchestrator.failTask")(function* (
    taskId: string,
    error: string,
  ) {
    yield* Ref.update(tasksRef, (tasks) => {
      const task = tasks.get(taskId);
      if (task) {
        const newTasks = new Map(tasks);
        newTasks.set(taskId, {
          ...task,
          status: "failed",
          error,
          updatedAt: new Date().toISOString(),
        });
        return newTasks;
      }
      return tasks;
    });
    yield* Effect.log(`[MultiAgent] Task failed: ${taskId} - ${error}`);
  });

  const getTaskStatus = Effect.fn("MultiAgentOrchestrator.getTaskStatus")(function* (
    taskId: string,
  ) {
    const tasks = yield* Ref.get(tasksRef);
    const task = tasks.get(taskId);
    if (!task) {
      return undefined;
    }
    return {
      taskId: task.id,
      status: task.status,
      progress: task.status === "completed" ? 100 : task.status === "in-progress" ? 50 : 0,
      result: task.result,
    };
  });

  const listTasks = Effect.fn("MultiAgentOrchestrator.listTasks")(function* (filters?: {
    agentId?: string;
    status?: AgentTask["status"];
  }) {
    const tasks = yield* Ref.get(tasksRef);
    let result = Array.from(tasks.values());
    if (filters?.agentId) {
      result = result.filter((t) => t.agentId === filters.agentId);
    }
    if (filters?.status) {
      result = result.filter((t) => t.status === filters.status);
    }
    return result;
  });

  const getTask = Effect.fn("MultiAgentOrchestrator.getTask")(function* (taskId: string) {
    const tasks = yield* Ref.get(tasksRef);
    return tasks.get(taskId);
  });

  const listAgents = Effect.fn("MultiAgentOrchestrator.listAgents")(function* () {
    const agents = yield* Ref.get(agentsRef);
    return Array.from(agents.values());
  });

  const setSharedContext = Effect.fn("MultiAgentOrchestrator.setSharedContext")(function* (
    key: string,
    value: unknown,
  ) {
    yield* Ref.update(sharedContextRef, (context) => {
      const newContext = new Map(context);
      newContext.set(key, value);
      return newContext;
    });
  });

  const getSharedContext = Effect.fn("MultiAgentOrchestrator.getSharedContext")(function* (
    key: string,
  ) {
    const context = yield* Ref.get(sharedContextRef);
    return context.get(key);
  });

  const getAllSharedContext = Effect.fn("MultiAgentOrchestrator.getAllSharedContext")(function* () {
    const context = yield* Ref.get(sharedContextRef);
    return Object.fromEntries(context);
  });

  // Check if task dependencies are satisfied
  const checkDependencies = Effect.fn("MultiAgentOrchestrator.checkDependencies")(function* (
    taskId: string,
  ) {
    const tasks = yield* Ref.get(tasksRef);
    const task = tasks.get(taskId);
    if (!task) return false;

    for (const depId of task.dependencies) {
      const dep = tasks.get(depId);
      if (!dep || dep.status !== "completed") {
        return false;
      }
    }
    return true;
  });

  // Get ready tasks (dependencies satisfied and status is pending)
  const getReadyTasks = Effect.fn("MultiAgentOrchestrator.getReadyTasks")(function* () {
    const tasks = yield* Ref.get(tasksRef);
    const readyTasks: AgentTask[] = [];

    for (const task of tasks.values()) {
      if (task.status === "pending") {
        const depsSatisfied = yield* checkDependencies(task.id);
        if (depsSatisfied) {
          readyTasks.push(task);
        }
      }
    }

    return readyTasks;
  });

  return {
    registerAgent,
    unregisterAgent,
    submitTask,
    startTask,
    completeTask,
    failTask,
    getTaskStatus,
    getTask,
    listTasks,
    listAgents,
    setSharedContext,
    getSharedContext,
    getAllSharedContext,
    checkDependencies,
    getReadyTasks,
  };
});

export const MultiAgentOrchestratorLive = Layer.effect(
  MultiAgentOrchestrator,
  makeMultiAgentOrchestrator,
);
