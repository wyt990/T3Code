import { DEFAULT_PROJECT_TRANSPORT, ProjectId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeSshConnectionPoolTestLayer } from "../../ssh/Layers/SshConnectionPool.ts";
import { SshFileSystem } from "../../ssh/Services/SshFileSystem.ts";
import { SshProcessRunner } from "../../ssh/Services/SshProcessRunner.ts";
import { PtyAdapter } from "../../terminal/Services/PTY.ts";
import { WorkspaceExecutionResolverLive } from "./WorkspaceExecutionResolver.ts";
import { WorkspaceExecutionResolver } from "../Services/WorkspaceExecution.ts";

const projectId = ProjectId.make("project-local");

const TestLayer = it.layer(
  WorkspaceExecutionResolverLive.pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(
      Layer.succeed(PtyAdapter, {
        spawn: () => Effect.die("PTY not used in resolver test"),
      }),
    ),
    Layer.provideMerge(makeSshConnectionPoolTestLayer({ clients: {} })),
    Layer.provideMerge(
      Layer.succeed(SshProcessRunner, {
        exec: () => Effect.die("SSH runner not used in local resolver test"),
        spawnInteractive: () => Effect.die("SSH runner not used in local resolver test"),
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(SshFileSystem, {
        list: () => Effect.die("SSH filesystem not used in local resolver test"),
        stat: () => Effect.die("SSH filesystem not used in local resolver test"),
        readFileString: () => Effect.die("SSH filesystem not used in local resolver test"),
        readFileBytes: () => Effect.die("SSH filesystem not used in local resolver test"),
        writeFileString: () => Effect.die("SSH filesystem not used in local resolver test"),
        makeDirectory: () => Effect.die("SSH filesystem not used in local resolver test"),
      }),
    ),
    Layer.provide(
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
                  title: "Local",
                  workspaceRoot: process.cwd(),
                  transport: DEFAULT_PROJECT_TRANSPORT,
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
    ),
  ),
);

TestLayer("WorkspaceExecutionResolver", (it) => {
  it.effect("resolves local execution for local transport projects", () =>
    Effect.gen(function* () {
      const resolver = yield* WorkspaceExecutionResolver;
      const execution = yield* resolver.resolveByProjectId(projectId);
      assert.equal(execution.kind, "local");
      assert.equal(execution.workspaceRoot, process.cwd());
      const listed = yield* execution.fileSystem.list(".");
      assert.ok(listed.length > 0);
    }),
  );
});
