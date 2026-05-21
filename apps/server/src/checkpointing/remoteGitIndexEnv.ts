import { randomUUID } from "node:crypto";

import { Effect, FileSystem, Option, Path } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { shellQuotePosix } from "../ssh/ssh2Adapter.ts";
import { WorkspaceExecutionResolver } from "../workspace/Services/WorkspaceExecution.ts";
import { CheckpointInvariantError } from "./Errors.ts";

const GIT_CHECKPOINT_AUTHOR_ENV = {
  GIT_AUTHOR_NAME: "T3 Code",
  GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
  GIT_COMMITTER_NAME: "T3 Code",
  GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
} as const;

const REMOTE_GIT_INDEX_MKTEMP = "mktemp -t t3-git-index-XXXXXX 2>/dev/null || mktemp 2>/dev/null";

export interface GitCheckpointIndexEnv {
  readonly commitEnv: NodeJS.ProcessEnv;
  readonly release: () => Effect.Effect<void>;
}

export const prepareGitCheckpointIndexEnv = (cwd: string) =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const workspaceExecutionResolver = yield* WorkspaceExecutionResolver;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const projectOption = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(cwd);
    if (Option.isNone(projectOption) || projectOption.value.transport.type !== "ssh") {
      const tempDir = yield* fileSystem.makeTempDirectory({ prefix: "t3-fs-checkpoint-" });
      const tempIndexPath = path.join(tempDir, `index-${randomUUID()}`);
      const commitEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...GIT_CHECKPOINT_AUTHOR_ENV,
        GIT_INDEX_FILE: tempIndexPath,
      };
      return {
        commitEnv,
        release: () => fileSystem.remove(tempDir, { recursive: true }).pipe(Effect.ignore),
      } satisfies GitCheckpointIndexEnv;
    }

    const execution = yield* workspaceExecutionResolver.resolveByProjectId(projectOption.value.id);
    const mktempResult = yield* execution.exec({
      command: REMOTE_GIT_INDEX_MKTEMP,
      cwd,
    });
    const indexPath = mktempResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (mktempResult.exitCode !== 0 || indexPath === undefined) {
      return yield* new CheckpointInvariantError({
        operation: "CheckpointStore.captureCheckpoint",
        detail: "Failed to allocate a remote git index file for checkpoint capture.",
        cause: mktempResult.stderr,
      });
    }

    const commitEnv: NodeJS.ProcessEnv = {
      ...GIT_CHECKPOINT_AUTHOR_ENV,
      GIT_INDEX_FILE: indexPath,
    };

    return {
      commitEnv,
      release: () =>
        execution
          .exec({
            command: `rm -f ${shellQuotePosix(indexPath)}`,
            cwd,
          })
          .pipe(Effect.ignore),
    } satisfies GitCheckpointIndexEnv;
  });
