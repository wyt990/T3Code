import type { ThreadId } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
  type WorkspaceExecutionResolverError,
} from "../workspace/Services/WorkspaceExecution.ts";
import { resolveRemoteClaudeBinaryPath } from "./remoteProviderBinary.ts";

export type ClaudeSpawnConfig =
  | { readonly kind: "local" }
  | {
      readonly kind: "ssh";
      readonly execution: WorkspaceExecution;
      readonly binaryPath: string;
    };

export type ResolveClaudeSpawnError = ProjectionRepositoryError | WorkspaceExecutionResolverError;

export const resolveClaudeSpawnForThread = (
  threadId: ThreadId,
  localBinaryPath: string,
  fallbackCwd?: string,
): Effect.Effect<
  ClaudeSpawnConfig,
  ResolveClaudeSpawnError,
  ProjectionSnapshotQuery | WorkspaceExecutionResolver
> =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const workspaceExecutionResolver = yield* WorkspaceExecutionResolver;

    // 先尝试通过 threadId 查找线程所属项目
    const threadShell = yield* projectionSnapshotQuery.getThreadShellById(threadId);
    if (Option.isSome(threadShell)) {
      const projectShell = yield* projectionSnapshotQuery.getProjectShellById(
        threadShell.value.projectId,
      );
      if (Option.isSome(projectShell) && projectShell.value.transport.type === "ssh") {
        const execution = yield* workspaceExecutionResolver.resolveByProjectId(
          projectShell.value.id,
        );
        const binaryPath = yield* resolveRemoteClaudeBinaryPath(execution, localBinaryPath);
        return { kind: "ssh", execution, binaryPath };
      }
      // 找到了线程但项目不是 SSH 传输，直接返回 local
      return { kind: "local" };
    }

    // 线程可能在投影中尚不可用（新建线程投影延迟），
    // 尝试通过 cwd（工作区根目录）反向查找项目
    if (fallbackCwd) {
      const project = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(fallbackCwd);
      if (Option.isSome(project) && project.value.transport.type === "ssh") {
        const execution = yield* workspaceExecutionResolver.resolveByProjectId(project.value.id);
        const binaryPath = yield* resolveRemoteClaudeBinaryPath(execution, localBinaryPath);
        return { kind: "ssh", execution, binaryPath };
      }
    }

    return { kind: "local" };
  });
