import type { ThreadId } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
  type WorkspaceExecutionResolverError,
} from "../workspace/Services/WorkspaceExecution.ts";
import { resolveRemoteOpenCodeBinaryPath } from "./remoteProviderBinary.ts";

export type OpenCodeSpawnConfig =
  | { readonly kind: "local" }
  | {
      readonly kind: "ssh";
      readonly execution: WorkspaceExecution;
      readonly binaryPath: string;
    };

export type ResolveOpenCodeSpawnError = ProjectionRepositoryError | WorkspaceExecutionResolverError;

export const resolveOpenCodeSpawnForThread = (
  threadId: ThreadId,
  localBinaryPath: string,
): Effect.Effect<
  OpenCodeSpawnConfig,
  ResolveOpenCodeSpawnError,
  ProjectionSnapshotQuery | WorkspaceExecutionResolver
> =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const workspaceExecutionResolver = yield* WorkspaceExecutionResolver;

    const threadShell = yield* projectionSnapshotQuery.getThreadShellById(threadId);
    if (Option.isNone(threadShell)) {
      return { kind: "local" };
    }

    const projectShell = yield* projectionSnapshotQuery.getProjectShellById(
      threadShell.value.projectId,
    );
    if (Option.isNone(projectShell) || projectShell.value.transport.type !== "ssh") {
      return { kind: "local" };
    }

    const execution = yield* workspaceExecutionResolver.resolveByProjectId(projectShell.value.id);
    const binaryPath = yield* resolveRemoteOpenCodeBinaryPath(execution, localBinaryPath);

    return {
      kind: "ssh",
      execution,
      binaryPath,
    };
  });
