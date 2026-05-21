import { ProjectId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
} from "../Services/WorkspaceExecution.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const remoteRoot = "/home/user/repo";
const projectId = ProjectId.make("project-ssh-entries");

const makeRemoteExecution = (): WorkspaceExecution => ({
  kind: "ssh",
  workspaceRoot: remoteRoot,
  sshConnectionId: "conn-1",
  spawnInteractive: () => Effect.die("unused"),
  exec: () => Effect.die("unused"),
  fileSystem: {
    list: (targetPath) =>
      Effect.succeed(
        targetPath === remoteRoot
          ? [
              {
                name: "src",
                path: `${remoteRoot}/src`,
                type: "directory" as const,
              },
              {
                name: "README.md",
                path: `${remoteRoot}/README.md`,
                type: "file" as const,
              },
            ]
          : targetPath === `${remoteRoot}/src`
            ? [
                {
                  name: "index.ts",
                  path: `${remoteRoot}/src/index.ts`,
                  type: "file" as const,
                },
              ]
            : [],
      ),
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

const SshEntriesLayer = Layer.empty.pipe(
  Layer.provideMerge(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(
    Layer.succeed(ProjectionSnapshotQuery, {
      getSnapshot: () => Effect.die("unused"),
      getShellSnapshot: () => Effect.die("unused"),
      getCounts: () => Effect.die("unused"),
      getActiveProjectByWorkspaceRoot: (cwd) =>
        Effect.succeed(
          cwd === remoteRoot
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
  ),
  Layer.provideMerge(
    Layer.succeed(WorkspaceExecutionResolver, {
      resolveByProjectId: (id) =>
        id === projectId ? Effect.succeed(makeRemoteExecution()) : Effect.die("unknown project"),
    }),
  ),
);

it.layer(SshEntriesLayer)("WorkspaceEntriesLive ssh", (it) => {
  it.effect("searches remote workspace entries via WorkspaceExecution.fileSystem", () =>
    Effect.gen(function* () {
      const workspaceEntries = yield* WorkspaceEntries;
      const result = yield* workspaceEntries.search({
        cwd: remoteRoot,
        query: "index",
        limit: 20,
      });

      assert.include(
        result.entries.map((entry) => entry.path),
        "src/index.ts",
      );
    }),
  );

  it.effect("browses relative paths under a remote project cwd", () =>
    Effect.gen(function* () {
      const workspaceEntries = yield* WorkspaceEntries;
      const result = yield* workspaceEntries.browse({
        cwd: remoteRoot,
        partialPath: "src/",
      });

      assert.equal(result.parentPath, `${remoteRoot}/src`);
      assert.deepEqual(
        result.entries.map((entry) => entry.name),
        [],
      );
    }),
  );
});
