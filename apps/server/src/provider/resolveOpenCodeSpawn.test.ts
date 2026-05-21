import { DEFAULT_PROJECT_TRANSPORT, ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
} from "../workspace/Services/WorkspaceExecution.ts";
import { unusedWorkspaceExecutionFileSystem } from "../workspace/workspaceExecutionTestStubs.ts";
import { resolveOpenCodeSpawnForThread } from "./resolveOpenCodeSpawn.ts";

const threadId = ThreadId.make("thread-ssh-opencode");
const projectId = ProjectId.make("project-ssh-opencode");
const remoteRoot = "/home/user/repo";

const makeSshExecution = (execCalls: Array<string>): WorkspaceExecution => ({
  kind: "ssh",
  workspaceRoot: remoteRoot,
  sshConnectionId: "conn-1",
  spawnInteractive: () => Effect.die("unused in resolveOpenCodeSpawn test"),
  exec: ({ command }) =>
    Effect.sync(() => {
      execCalls.push(command);
      return {
        stdout: "/usr/bin/opencode\n",
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
                  provider: "opencode",
                  model: "openai/gpt-4.1",
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

SshResolveLayer("resolveOpenCodeSpawnForThread", (it) => {
  it.effect("returns ssh spawn config for SSH project threads", () =>
    Effect.gen(function* () {
      sshExecCalls.length = 0;
      const spawn = yield* resolveOpenCodeSpawnForThread(threadId, "opencode");
      assert.strictEqual(spawn.kind, "ssh");
      if (spawn.kind !== "ssh") {
        return;
      }
      assert.strictEqual(spawn.binaryPath, "/usr/bin/opencode");
      assert.strictEqual(spawn.execution.workspaceRoot, remoteRoot);
      assert.strictEqual(sshExecCalls.length, 1);
    }),
  );

  it.effect("returns local spawn when thread is missing", () =>
    Effect.gen(function* () {
      const spawn = yield* resolveOpenCodeSpawnForThread(
        ThreadId.make("missing-thread"),
        "opencode",
      );
      assert.strictEqual(spawn.kind, "local");
    }),
  );

  it.effect("returns local spawn for local transport projects", () =>
    Effect.gen(function* () {
      const localThreadId = ThreadId.make("thread-local-opencode");
      const spawn = yield* resolveOpenCodeSpawnForThread(localThreadId, "opencode").pipe(
        Effect.provideService(ProjectionSnapshotQuery, {
          getSnapshot: () => Effect.die("unused"),
          getShellSnapshot: () => Effect.die("unused"),
          getCounts: () => Effect.die("unused"),
          getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
          getProjectShellById: () =>
            Effect.succeed(
              Option.some({
                id: projectId,
                title: "Local",
                workspaceRoot: "D:\\repo",
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
          getThreadShellById: (id) =>
            Effect.succeed(
              id === localThreadId
                ? Option.some({
                    id: localThreadId,
                    projectId,
                    title: "Thread",
                    modelSelection: {
                      provider: "opencode",
                      model: "openai/gpt-4.1",
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
        Effect.provideService(WorkspaceExecutionResolver, {
          resolveByProjectId: () => Effect.die("should not resolve execution for local transport"),
        }),
      );
      assert.strictEqual(spawn.kind, "local");
    }),
  );
});
