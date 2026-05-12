import { Context, Effect, Layer } from "effect";

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

export interface MultiAgentOrchestrator {
  readonly registerAgent: (config: AgentConfig) => Effect.Effect<void, never, never>;
  readonly unregisterAgent: (agentId: string) => Effect.Effect<void, never, never>;
  readonly submitTask: (
    task: Omit<AgentTask, "status" | "createdAt" | "updatedAt">,
  ) => Effect.Effect<AgentTask, never, never>;
  readonly startTask: (taskId: string) => Effect.Effect<boolean, never, never>;
  readonly completeTask: (taskId: string, result: unknown) => Effect.Effect<void, never, never>;
  readonly failTask: (taskId: string, error: string) => Effect.Effect<void, never, never>;
  readonly getTaskStatus: (taskId: string) => Effect.Effect<TaskStatus | undefined, never, never>;
  readonly getTask: (taskId: string) => Effect.Effect<AgentTask | undefined, never, never>;
  readonly listTasks: (filters?: {
    agentId?: string;
    status?: AgentTask["status"];
  }) => Effect.Effect<AgentTask[], never, never>;
  readonly listAgents: () => Effect.Effect<AgentConfig[], never, never>;
  readonly setSharedContext: (key: string, value: unknown) => Effect.Effect<void, never, never>;
  readonly getSharedContext: (key: string) => Effect.Effect<unknown, never, never>;
  readonly getAllSharedContext: () => Effect.Effect<Record<string, unknown>, never, never>;
  readonly checkDependencies: (taskId: string) => Effect.Effect<boolean, never, never>;
  readonly getReadyTasks: () => Effect.Effect<AgentTask[], never, never>;
}

export const MultiAgentOrchestrator = Context.Service<MultiAgentOrchestrator>(
  "@t3tools/server/orchestration/MultiAgentOrchestrator",
);

// Schema definitions
export interface Task {
  id: string;
  agentId: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  dependencies: string[];
  payload: unknown;
}

export interface TaskStatus {
  taskId: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  progress: number;
  result?: unknown;
}
