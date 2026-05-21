import { DEFAULT_PROJECT_TRANSPORT, ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
} from "../workspace/Services/WorkspaceExecution.ts";
import { unusedWorkspaceExecutionFileSystem } from "../workspace/workspaceExecutionTestStubs.ts";
import { resolveCodexSpawnForThread } from "./resolveCodexSpawn.ts";

const threadId = ThreadId.make("thread-ssh-codex");
const projectId = ProjectId.make("project-ssh-codex");
const remoteRoot = "/home/user/repo";

const makeSshExecution = (execCalls: Array<string>): WorkspaceExecution => ({
  kind: "ssh",
  workspaceRoot: remoteRoot,
  sshConnectionId: "conn-1",
  spawnInteractive: () => Effect.die("unused in resolveCodexSpawn test"),
  exec: ({ command }) =>
    Effect.sync(() => {
      execCalls.push(command);
      return {
        stdout: "/usr/bin/codex\n",
        stderr: "",
        exitCode: 0,
      };
    }),
  fileSystem: unusedWorkspaceExecutionFileSystem(),
  terminal: {
    open: () => Effect.die("unused"),
  },
});

const sshExecCalls: string[] = [];

const SshResolveLayer = it.layer(
  Layer.mergeAll(
    Layer.succeed(ProjectionSnapshotQuery, {
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getProjectShellById: (id) =>
        Effect.succeed(
          id === projectId
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
              })
            : Option.none(),
        ),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      getThreadShellById: (id) =>
        Effect.succeed(
          id === threadId
            ? Option.some({
                id: threadId,
                projectId,
                title: "Thread",
                modelSelection: {
                  provider: "codex",
                  model: "gpt-5.3-codex",
                },
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                latestTurn: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                archivedAt: null,
                session: null,
                latestUserMessageAt: null,
                hasPendingApprovals: false,
                hasPendingUserInput: false,
                hasActionableProposedPlan: false,
              })
            : Option.none(),
        ),
      getThreadDetailById: () => Effect.succeed(Option.none()),
    }),
    Layer.succeed(WorkspaceExecutionResolver, {
      resolveByProjectId: (id) =>
        id === projectId ? Effect.succeed(makeSshExecution(sshExecCalls)) : Effect.die("unknown"),
    }),
  ),
);

SshResolveLayer("resolveCodexSpawnForThread", (it) => {
  it.effect("resolves ssh spawn with probed remote binary path", () =>
    Effect.gen(function* () {
      sshExecCalls.length = 0;
      const spawn = yield* resolveCodexSpawnForThread(threadId, "codex");

      assert.equal(spawn.kind, "ssh");
      if (spawn.kind !== "ssh") {
        return;
      }
      assert.equal(spawn.binaryPath, "/usr/bin/codex");
      assert.equal(sshExecCalls.length, 1);
      assert.include(sshExecCalls[0] ?? "", "codex");
    }),
  );
});

const LocalResolveLayer = it.layer(
  Layer.mergeAll(
    Layer.succeed(ProjectionSnapshotQuery, {
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({
            id: projectId,
            title: "Local",
            workspaceRoot: process.cwd(),
            transport: DEFAULT_PROJECT_TRANSPORT,
            repositoryIdentity: null,
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      getThreadShellById: () => Effect.succeed(Option.none()),
      getThreadDetailById: () => Effect.succeed(Option.none()),
    }),
    Layer.succeed(WorkspaceExecutionResolver, {
      resolveByProjectId: () => Effect.die("unused"),
    }),
  ),
);

LocalResolveLayer("resolveCodexSpawnForThread local", (it) => {
  it.effect("uses local spawn for non-ssh projects", () =>
    Effect.gen(function* () {
      const spawn = yield* resolveCodexSpawnForThread(threadId, "codex");
      assert.equal(spawn.kind, "local");
    }),
  );
});
