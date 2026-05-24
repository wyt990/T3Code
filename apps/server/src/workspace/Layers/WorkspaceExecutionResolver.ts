import { ChildProcessSpawner } from "effect/unstable/process";
import { Effect, Layer, Option, Scope } from "effect";
import { FileSystem, Path } from "effect";
import type { ProjectId } from "@t3tools/contracts";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SshConnectionPool } from "../../ssh/Services/SshConnectionPool.ts";
import { SshFileSystem } from "../../ssh/Services/SshFileSystem.ts";
import { SshProcessRunner } from "../../ssh/Services/SshProcessRunner.ts";
import { PtyAdapter } from "../../terminal/Services/PTY.ts";
import {
  WorkspaceExecutionProjectNotFoundError,
  WorkspaceExecutionResolver,
  WorkspaceExecutionUnsupportedTransportError,
} from "../Services/WorkspaceExecution.ts";
import { createLocalWorkspaceExecution } from "./LocalExecution.ts";
import { createSshWorkspaceExecution } from "./SshExecution.ts";

export const makeWorkspaceExecutionResolver = Effect.gen(function* () {
  const resolveByProjectId = ((projectId: ProjectId) =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      yield* Effect.logDebug("[WorkspaceExecutionResolver] querying project shell", { projectId });

      const project = yield* snapshotQuery.getProjectShellById(projectId);
      if (Option.isNone(project)) {
        yield* Effect.logInfo("[WorkspaceExecutionResolver] project not found", { projectId });
        return yield* new WorkspaceExecutionProjectNotFoundError({ projectId });
      }

      yield* Effect.logDebug("[WorkspaceExecutionResolver] project shell found", {
        projectId,
        transportType: project.value.transport.type,
      });

      const shell = project.value;
      if (shell.transport.type === "local") {
        const localDeps = {
          fileSystem: yield* FileSystem.FileSystem,
          path: yield* Path.Path,
          spawner: yield* ChildProcessSpawner.ChildProcessSpawner,
          ptyAdapter: yield* PtyAdapter,
          scope: yield* Scope.Scope,
        };
        return createLocalWorkspaceExecution(localDeps, shell.workspaceRoot);
      }

      if (shell.transport.type === "ssh") {
        const sshDeps = {
          runner: yield* SshProcessRunner,
          remoteFileSystem: yield* SshFileSystem,
          pool: yield* SshConnectionPool,
        };

        yield* Effect.logDebug("[WorkspaceExecutionResolver] SSH dependencies resolved", {
          hasRunner: sshDeps.runner !== undefined,
          hasRemoteFileSystem: sshDeps.remoteFileSystem !== undefined,
          hasPool: sshDeps.pool !== undefined,
        });

        return createSshWorkspaceExecution(sshDeps, {
          connectionId: shell.transport.sshConnectionId,
          workspaceRoot: shell.workspaceRoot,
        });
      }

      return yield* new WorkspaceExecutionUnsupportedTransportError({
        projectId,
        transportType: "unknown",
      });
    })) as (typeof WorkspaceExecutionResolver)["Service"]["resolveByProjectId"];

  return { resolveByProjectId } satisfies (typeof WorkspaceExecutionResolver)["Service"];
});

export const WorkspaceExecutionResolverLive = Layer.effect(
  WorkspaceExecutionResolver,
  makeWorkspaceExecutionResolver,
);
