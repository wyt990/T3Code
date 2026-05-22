import { DEFAULT_PROJECT_TRANSPORT, ProjectId, type ProjectTransport } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeSshConnectionPoolTestLayer } from "../../ssh/Layers/SshConnectionPool.ts";
import { SshFileSystem } from "../../ssh/Services/SshFileSystem.ts";
import { SshProcessRunner } from "../../ssh/Services/SshProcessRunner.ts";
import { PtyAdapter } from "../../terminal/Services/PTY.ts";
import { WorkspaceExecutionResolverLive } from "./WorkspaceExecutionResolver.ts";
import {
  WorkspaceExecutionResolver,
  WorkspaceExecutionUnsupportedTransportError,
} from "../Services/WorkspaceExecution.ts";

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
    Layer.provideMerge(
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

const sshProjectId = ProjectId.make("project-ssh");

const sshTestLayer = it.layer(
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
        exec: () => Effect.die("SSH runner not used in resolver test"),
        spawnInteractive: () => Effect.die("SSH runner not used in resolver test"),
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(SshFileSystem, {
        list: () => Effect.die("SSH filesystem not used in resolver test"),
        stat: () => Effect.die("SSH filesystem not used in resolver test"),
        readFileString: () => Effect.die("SSH filesystem not used in resolver test"),
        readFileBytes: () => Effect.die("SSH filesystem not used in resolver test"),
        writeFileString: () => Effect.die("SSH filesystem not used in resolver test"),
        makeDirectory: () => Effect.die("SSH filesystem not used in resolver test"),
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(ProjectionSnapshotQuery, {
        getSnapshot: () => Effect.die("unused"),
        getShellSnapshot: () => Effect.die("unused"),
        getCounts: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
        getProjectShellById: (id) =>
          Effect.succeed(
            id === sshProjectId
              ? Option.some({
                  id: sshProjectId,
                  title: "SSH",
                  workspaceRoot: "/remote/project",
                  transport: { type: "ssh", sshConnectionId: "conn-ssh" },
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

  it.effect("fails with WorkspaceExecutionUnsupportedTransportError for unknown transport", () =>
    Effect.gen(function* () {
      const badProjectId = ProjectId.make("project-bad-transport");
      const badLayer = WorkspaceExecutionResolverLive.pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(
          Layer.succeed(PtyAdapter, {
            spawn: () => Effect.die("unused"),
          }),
        ),
        Layer.provideMerge(makeSshConnectionPoolTestLayer({ clients: {} })),
        Layer.provideMerge(
          Layer.succeed(SshProcessRunner, {
            exec: () => Effect.die("unused"),
            spawnInteractive: () => Effect.die("unused"),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(SshFileSystem, {
            list: () => Effect.die("unused"),
            stat: () => Effect.die("unused"),
            readFileString: () => Effect.die("unused"),
            readFileBytes: () => Effect.die("unused"),
            writeFileString: () => Effect.die("unused"),
            makeDirectory: () => Effect.die("unused"),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionSnapshotQuery, {
            getSnapshot: () => Effect.die("unused"),
            getShellSnapshot: () => Effect.die("unused"),
            getCounts: () => Effect.die("unused"),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: (id) =>
              Effect.succeed(
                id === badProjectId
                  ? Option.some({
                      id: badProjectId,
                      title: "Bad",
                      workspaceRoot: "/tmp",
                      transport: { type: "cloud" } as unknown as ProjectTransport,
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
      );

      const error = yield* Effect.gen(function* () {
        const resolver = yield* WorkspaceExecutionResolver;
        return yield* resolver.resolveByProjectId(badProjectId);
      }).pipe(Effect.provide(badLayer), Effect.flip);

      assert.ok(error instanceof WorkspaceExecutionUnsupportedTransportError);
      assert.equal(error.transportType, "cloud");
    }),
  );
});

sshTestLayer("WorkspaceExecutionResolver ssh", (it) => {
  it.effect("resolves ssh execution for ssh transport projects", () =>
    Effect.gen(function* () {
      const resolver = yield* WorkspaceExecutionResolver;
      const execution = yield* resolver.resolveByProjectId(sshProjectId);
      assert.equal(execution.kind, "ssh");
      assert.equal(execution.sshConnectionId, "conn-ssh");
      assert.equal(execution.workspaceRoot, "/remote/project");
    }),
  );
});
