import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
} from "../../workspace/Services/WorkspaceExecution.ts";
import { unusedWorkspaceExecutionFileSystem } from "../../workspace/workspaceExecutionTestStubs.ts";
import { GitCore } from "../Services/GitCore.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { GitCoreLive } from "./GitCore.ts";

const remoteRoot = "/home/user/repo";
const projectId = ProjectId.make("project-ssh-git");

const makeSshGitCoreTestLayer = (
  execCalls: Array<{ command: string; cwd?: string; stdin?: string }>,
  execImpl?: WorkspaceExecution["exec"],
) => {
  const sshExecution: WorkspaceExecution = {
    kind: "ssh",
    workspaceRoot: remoteRoot,
    sshConnectionId: "conn-1",
    spawnInteractive: () => Effect.die("unused"),
    exec:
      execImpl ??
      ((input) =>
        Effect.sync(() => {
          execCalls.push({
            command: input.command,
            ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
            ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
          });
          return { stdout: "", stderr: "", exitCode: 0 };
        })),
    fileSystem: unusedWorkspaceExecutionFileSystem(),
    terminal: {
      open: () => Effect.die("unused"),
    },
  };

  return GitCoreLive.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-ssh-test-" })),
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provideMerge(
      Layer.mergeAll(
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
          getThreadShellById: () => Effect.succeed(Option.none()),
          getThreadDetailById: () => Effect.succeed(Option.none()),
        }),
        Layer.succeed(WorkspaceExecutionResolver, {
          resolveByProjectId: (id) =>
            id === projectId ? Effect.succeed(sshExecution) : Effect.die("unknown project"),
        }),
      ),
    ),
  );
};

const sshExecCalls: Array<{ command: string; cwd?: string; stdin?: string }> = [];

const SshGitCoreTestLayer = it.layer(makeSshGitCoreTestLayer(sshExecCalls));

SshGitCoreTestLayer("GitCore SSH execution", (it) => {
  it.effect("routes git execute through WorkspaceExecution.exec for SSH projects", () =>
    Effect.gen(function* () {
      sshExecCalls.length = 0;
      const gitCore = yield* GitCore;
      yield* gitCore.execute({
        operation: "GitCore.ssh.test",
        cwd: remoteRoot,
        args: ["status", "--porcelain"],
        allowNonZeroExit: true,
      });

      assert.equal(sshExecCalls.length, 1);
      assert.equal(sshExecCalls[0]?.cwd, remoteRoot);
      assert.match(sshExecCalls[0]?.command ?? "", /^git /);
      assert.include(sshExecCalls[0]?.command ?? "", "status");
    }),
  );

  it.effect("forwards stdin to remote git exec", () =>
    Effect.gen(function* () {
      sshExecCalls.length = 0;
      const gitCore = yield* GitCore;
      yield* gitCore.execute({
        operation: "GitCore.ssh.stdin",
        cwd: remoteRoot,
        args: ["check-ignore", "--stdin"],
        stdin: "src/main.ts\0",
        allowNonZeroExit: true,
      });

      assert.equal(sshExecCalls[0]?.stdin, "src/main.ts\0");
    }),
  );

  it.effect(
    "treats non-zero SSH git exits as success when allowNonZeroExit is set (e.g. missing origin/HEAD)",
    () =>
      Effect.gen(function* () {
        const gitCore = yield* GitCore;
        const result = yield* gitCore.execute({
          operation: "GitCore.ssh.nonZero",
          cwd: remoteRoot,
          args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
          allowNonZeroExit: true,
        });

        assert.equal(result.code, 128);
        assert.include(result.stderr, "not a symbolic ref");
      }).pipe(
        Effect.provide(
          makeSshGitCoreTestLayer(sshExecCalls, (input) =>
            Effect.sync(() => {
              sshExecCalls.push({
                command: input.command,
                ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
              });
              return {
                stdout: "",
                stderr: "fatal: ref refs/remotes/origin/HEAD is not a symbolic ref\n",
                exitCode: 128,
              };
            }),
          ),
        ),
      ),
  );

  it.effect("listBranches succeeds when origin/HEAD symbolic-ref is missing on SSH", () =>
    Effect.gen(function* () {
      const gitCore = yield* GitCore;
      const page = yield* gitCore.listBranches({ cwd: remoteRoot, cursor: 0, limit: 50 });

      assert.equal(page.isRepo, true);
      assert.deepEqual(
        page.branches.map((branch) => branch.name),
        ["main"],
      );
      assert.equal(page.branches[0]?.current, true);
    }).pipe(
      Effect.provide(
        makeSshGitCoreTestLayer(sshExecCalls, (input) =>
          Effect.sync(() => {
            sshExecCalls.push({
              command: input.command,
              ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
            });
            if (input.command.includes("symbolic-ref")) {
              return {
                stdout: "",
                stderr: "fatal: ref refs/remotes/origin/HEAD is not a symbolic ref\n",
                exitCode: 128,
              };
            }
            if (input.command.includes("branch --no-color --no-column --remotes")) {
              return { stdout: "", stderr: "", exitCode: 0 };
            }
            if (input.command.includes("branch --no-color --no-column")) {
              return { stdout: "* main\n", stderr: "", exitCode: 0 };
            }
            return { stdout: "", stderr: "", exitCode: 0 };
          }),
        ),
      ),
    ),
  );
});
