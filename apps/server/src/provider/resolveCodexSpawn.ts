import type { ThreadId } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecutionResolverError,
} from "../workspace/Services/WorkspaceExecution.ts";
import type { CodexSpawnConfig } from "./Layers/CodexSessionRuntime.ts";
import { resolveRemoteCodexBinaryPath } from "./remoteProviderBinary.ts";

export type ResolveCodexSpawnError = ProjectionRepositoryError | WorkspaceExecutionResolverError;

export const resolveCodexSpawnForThread = (
  threadId: ThreadId,
  localBinaryPath: string,
  fallbackCwd?: string,
): Effect.Effect<
  CodexSpawnConfig,
  ResolveCodexSpawnError,
  ProjectionSnapshotQuery | WorkspaceExecutionResolver
> =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const workspaceExecutionResolver = yield* WorkspaceExecutionResolver;

    const threadShell = yield* projectionSnapshotQuery.getThreadShellById(threadId);
    if (Option.isSome(threadShell)) {
      const projectShell = yield* projectionSnapshotQuery.getProjectShellById(
        threadShell.value.projectId,
      );
      if (Option.isSome(projectShell) && projectShell.value.transport.type === "ssh") {
        const execution = yield* workspaceExecutionResolver.resolveByProjectId(
          projectShell.value.id,
        );
        const binaryPath = yield* resolveRemoteCodexBinaryPath(execution, localBinaryPath);
        return { kind: "ssh", execution, binaryPath };
      }
      return { kind: "local" };
    }

    if (fallbackCwd) {
      const project = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(fallbackCwd);
      if (Option.isSome(project) && project.value.transport.type === "ssh") {
        const execution = yield* workspaceExecutionResolver.resolveByProjectId(project.value.id);
        const binaryPath = yield* resolveRemoteCodexBinaryPath(execution, localBinaryPath);
        return { kind: "ssh", execution, binaryPath };
      }
    }

    return { kind: "local" };
  });
