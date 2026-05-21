import { ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import type { TestRunConfig } from "@t3tools/contracts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { WorkspaceExecution } from "../workspace/Services/WorkspaceExecution.ts";
import {
  executeWorkspaceTestRunEffect,
  runVitestInWorkspaceRemote,
} from "./runVitestInWorkspace.ts";

const remoteRoot = "/home/user/repo";

const makeRemoteExecution = (): WorkspaceExecution => ({
  kind: "ssh",
  workspaceRoot: remoteRoot,
  sshConnectionId: "conn-test",
  spawnInteractive: () => Effect.die("unused"),
  exec: (input) => {
    if (input.command.startsWith("bun ") && input.command.includes("vitest")) {
      return Effect.succeed({
        stdout: "✓ remote vitest ok\n",
        stderr: "",
        exitCode: 0,
      });
    }
    return Effect.succeed({
      stdout: "",
      stderr: "command not found: bun",
      exitCode: 127,
    });
  },
  fileSystem: {
    list: () => Effect.die("unused"),
    stat: () => Effect.die("unused"),
    readFileString: () => Effect.die("unused"),
    readFileBytes: () => Effect.die("unused"),
    writeFileString: () => Effect.die("unused"),
    makeDirectory: () => Effect.die("unused"),
  },
  terminal: {
    open: () => Effect.die("unused"),
  },
});

const baseConfig = (): TestRunConfig => ({
  id: "run-1",
  name: "remote vitest",
  testFiles: ["apps/web/src/foo.test.ts"],
  parallel: false,
  timeout: 60_000,
  environment: {},
  coverage: false,
  coverageThreshold: 0,
  workspaceRoot: remoteRoot,
});

it.effect("runVitestInWorkspaceRemote runs bun vitest on SSH host", () =>
  Effect.gen(function* () {
    const result = yield* runVitestInWorkspaceRemote(baseConfig(), makeRemoteExecution());
    assert.equal(result.status, "passed");
    assert.equal(result.testsPassed, 1);
  }),
);

it.effect("executeWorkspaceTestRunEffect routes SSH projects to remote exec", () =>
  Effect.gen(function* () {
    const mockProjection: ProjectionSnapshotQueryShape = {
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: (cwd) =>
        Effect.succeed(
          cwd === remoteRoot
            ? Option.some({
                id: ProjectId.make("project-ssh-test"),
                title: "Remote",
                workspaceRoot: remoteRoot,
                transport: { type: "ssh", sshConnectionId: "conn-test" },
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
    };

    const result = yield* executeWorkspaceTestRunEffect(baseConfig(), {
      projectionSnapshotQuery: mockProjection,
      workspaceExecutionResolver: {
        resolveByProjectId: () => Effect.succeed(makeRemoteExecution()),
      },
    });

    assert.equal(result.status, "passed");
  }),
);
