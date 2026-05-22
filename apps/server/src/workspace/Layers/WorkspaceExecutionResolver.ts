import { ChildProcessSpawner } from "effect/unstable/process";
import { Effect, Layer, Option, Scope } from "effect";
import { FileSystem, Path } from "effect";

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

const makeSshDeps = Effect.fn("makeSshDeps")(function* () {
  return {
    runner: yield* SshProcessRunner,
    remoteFileSystem: yield* SshFileSystem,
    pool: yield* SshConnectionPool,
  };
});

const makeLocalDeps = Effect.fn("makeLocalDeps")(function* () {
  return {
    fileSystem: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
    spawner: yield* ChildProcessSpawner.ChildProcessSpawner,
    ptyAdapter: yield* PtyAdapter,
    scope: yield* Scope.Scope,
  };
});

export const makeWorkspaceExecutionResolver = Effect.gen(function* () {
  yield* Effect.logInfo("[WorkspaceExecutionResolver] makeWorkspaceExecutionResolver starting");

  const resolveByProjectId: (typeof WorkspaceExecutionResolver)["Service"]["resolveByProjectId"] = (
    projectId,
  ) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("[WorkspaceExecutionResolver] resolving execution for project", {
        projectId,
      });
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
        yield* Effect.logInfo("[WorkspaceExecutionResolver] creating local workspace execution", {
          projectId,
          workspaceRoot: shell.workspaceRoot,
        });
        const localDeps = yield* makeLocalDeps();
        return createLocalWorkspaceExecution(localDeps, shell.workspaceRoot);
      }

      if (shell.transport.type === "ssh") {
        yield* Effect.logInfo("[WorkspaceExecutionResolver] creating SSH workspace execution", {
          projectId,
          workspaceRoot: shell.workspaceRoot,
          connectionId: shell.transport.sshConnectionId,
        });

        const sshDeps = yield* makeSshDeps();

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

      const transportType =
        typeof shell.transport === "object" &&
        shell.transport !== null &&
        "type" in shell.transport &&
        typeof shell.transport.type === "string"
          ? shell.transport.type
          : "unknown";

      return yield* new WorkspaceExecutionUnsupportedTransportError({
        projectId,
        transportType,
      });
    });

  return { resolveByProjectId } satisfies (typeof WorkspaceExecutionResolver)["Service"];
});

export const WorkspaceExecutionResolverLive = Layer.effect(
  WorkspaceExecutionResolver,
  makeWorkspaceExecutionResolver,
);
