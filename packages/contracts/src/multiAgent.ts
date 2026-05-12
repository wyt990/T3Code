/**
 * Multi-agent orchestration RPC schemas.
 *
 * @module multiAgent
 */
import { Schema } from "effect";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection, ProviderInteractionMode, RuntimeMode } from "./orchestration.ts";

export const MultiAgentRole = Schema.Literals([
  "architect",
  "coder",
  "reviewer",
  "tester",
  "doc-writer",
  "custom",
]);
export type MultiAgentRole = typeof MultiAgentRole.Type;

export const MultiAgentConfig = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: MultiAgentRole,
  name: TrimmedNonEmptyString,
  capabilities: Schema.Array(TrimmedNonEmptyString),
  maxConcurrentTasks: Schema.Number,
});
export type MultiAgentConfig = typeof MultiAgentConfig.Type;

export const MultiAgentTaskStatus = Schema.Literals([
  "pending",
  "in-progress",
  "completed",
  "failed",
]);

export const MultiAgentTask = Schema.Struct({
  id: TrimmedNonEmptyString,
  agentId: TrimmedNonEmptyString,
  role: MultiAgentRole,
  status: MultiAgentTaskStatus,
  dependencies: Schema.Array(TrimmedNonEmptyString),
  payload: Schema.Unknown,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
});
export type MultiAgentTask = typeof MultiAgentTask.Type;

/** Payload for submitting a new task (server assigns status and timestamps). */
export const MultiAgentTaskSubmit = Schema.Struct({
  id: TrimmedNonEmptyString,
  agentId: TrimmedNonEmptyString,
  role: MultiAgentRole,
  dependencies: Schema.Array(TrimmedNonEmptyString),
  payload: Schema.Unknown,
});
export type MultiAgentTaskSubmit = typeof MultiAgentTaskSubmit.Type;

/** When present on a task payload, `multiAgent.startTask` may dispatch `thread.turn.start` to the thread. */
export const MultiAgentProviderDispatch = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  /** If set, used as the user message body (still length-clamped server-side). Otherwise the server composes from task + shared context + dependency results. */
  prompt: Schema.optional(Schema.String),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type MultiAgentProviderDispatch = typeof MultiAgentProviderDispatch.Type;

export const MultiAgentRoleTemplate = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: MultiAgentRole,
  name: TrimmedNonEmptyString,
  instructions: Schema.String,
  createdAt: Schema.String,
});
export type MultiAgentRoleTemplate = typeof MultiAgentRoleTemplate.Type;

export const MultiAgentRoleTemplateUpsert = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: MultiAgentRole,
  name: TrimmedNonEmptyString,
  instructions: Schema.String,
});
export type MultiAgentRoleTemplateUpsert = typeof MultiAgentRoleTemplateUpsert.Type;
