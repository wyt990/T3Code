import type { ThreadId } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
  type WorkspaceExecutionResolverError,
} from "../workspace/Services/WorkspaceExecution.ts";
import { resolveRemoteCursorBinaryPath } from "./remoteProviderBinary.ts";

export type CursorSpawnConfig =
  | { readonly kind: "local" }
  | {
      readonly kind: "ssh";
      readonly execution: WorkspaceExecution;
      readonly binaryPath: string;
    };

export type ResolveCursorSpawnError = ProjectionRepositoryError | WorkspaceExecutionResolverError;

export const resolveCursorSpawnForThread = (
  threadId: ThreadId,
  localBinaryPath: string,
  fallbackCwd?: string,
): Effect.Effect<
  CursorSpawnConfig,
  ResolveCursorSpawnError,
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
        const binaryPath = yield* resolveRemoteCursorBinaryPath(execution, localBinaryPath);
        return { kind: "ssh", execution, binaryPath };
      }
      return { kind: "local" };
    }

    if (fallbackCwd) {
      const project = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(fallbackCwd);
      if (Option.isSome(project) && project.value.transport.type === "ssh") {
        const execution = yield* workspaceExecutionResolver.resolveByProjectId(project.value.id);
        const binaryPath = yield* resolveRemoteCursorBinaryPath(execution, localBinaryPath);
        return { kind: "ssh", execution, binaryPath };
      }
    }

    return { kind: "local" };
  });
