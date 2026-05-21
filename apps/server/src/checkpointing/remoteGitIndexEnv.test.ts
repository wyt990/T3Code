import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
} from "../workspace/Services/WorkspaceExecution.ts";
import { unusedWorkspaceExecutionFileSystem } from "../workspace/workspaceExecutionTestStubs.ts";
import { prepareGitCheckpointIndexEnv } from "./remoteGitIndexEnv.ts";

const remoteRoot = "/home/user/repo";
const projectId = ProjectId.make("project-ssh-checkpoint");
const execCalls: Array<{ command: string; cwd?: string }> = [];

const sshExecution: WorkspaceExecution = {
  kind: "ssh",
  workspaceRoot: remoteRoot,
  sshConnectionId: "conn-1",
  spawnInteractive: () => Effect.die("unused"),
  exec: (input) =>
    Effect.sync(() => {
      execCalls.push({ command: input.command, ...(input.cwd ? { cwd: input.cwd } : {}) });
      if (input.command.includes("mktemp")) {
        return { stdout: "/tmp/t3-git-index-abc\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }),
  fileSystem: unusedWorkspaceExecutionFileSystem(),
  terminal: { open: () => Effect.die("unused") },
};

const TestLayer = it.layer(
  Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(ProjectionSnapshotQuery, {
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: (workspaceRoot) =>
        Effect.succeed(
          workspaceRoot === remoteRoot
            ? Option.some({
                id: projectId,
                title: "Remote",
                workspaceRoot: remoteRoot,
                transport: { type: "ssh", sshConnectionId: "conn-1" },
                repositoryIdentity: null,
                defaultModelSelection: null,
                scripts: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                deletedAt: null,
              })
            : Option.none(),
        ),
      getProjectShellById: () => Effect.succeed(Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      getThreadShellById: () => Effect.succeed(Option.none()),
      getThreadDetailById: () => Effect.succeed(Option.none()),
    }),
    Layer.succeed(WorkspaceExecutionResolver, {
      resolveByProjectId: (id) =>
        id === projectId ? Effect.succeed(sshExecution) : Effect.die("unknown"),
    }),
  ),
);

TestLayer("prepareGitCheckpointIndexEnv", (it) => {
  it.effect("allocates remote GIT_INDEX_FILE for SSH projects", () =>
    Effect.gen(function* () {
      execCalls.length = 0;
      const prepared = yield* prepareGitCheckpointIndexEnv(remoteRoot);
      assert.strictEqual(prepared.commitEnv.GIT_INDEX_FILE, "/tmp/t3-git-index-abc");
      assert.match(execCalls[0]?.command ?? "", /mktemp/);
      yield* prepared.release();
      assert.match(execCalls.at(-1)?.command ?? "", /rm -f/);
    }),
  );
});
