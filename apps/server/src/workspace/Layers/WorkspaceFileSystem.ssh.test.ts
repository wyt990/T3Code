import { ProjectId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceFileSystem } from "../Services/WorkspaceFileSystem.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
} from "../Services/WorkspaceExecution.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";
import { WorkspaceFileSystemLive } from "./WorkspaceFileSystem.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const remoteRoot = "/home/user/repo";
const projectId = ProjectId.make("project-ssh-write");

it.effect("writes workspace files over remote WorkspaceExecution.fileSystem", () =>
  Effect.gen(function* () {
    const writes = yield* Ref.make<Array<{ path: string; contents: string }>>([]);
    const remoteExecution: WorkspaceExecution = {
      kind: "ssh",
      workspaceRoot: remoteRoot,
      sshConnectionId: "conn-1",
      spawnInteractive: () => Effect.die("unused"),
      exec: () => Effect.die("unused"),
      fileSystem: {
        list: () => Effect.succeed([]),
        stat: () => Effect.die("unused"),
        readFileString: () => Effect.die("unused"),
        readFileBytes: () => Effect.die("unused"),
        writeFileString: (input) =>
          Ref.update(writes, (current) => [...current, input]).pipe(Effect.asVoid),
        makeDirectory: () => Effect.void,
        unlink: () => Effect.die("unused"),
        rmdir: () => Effect.die("unused"),
        rename: () => Effect.die("unused"),
      },
      terminal: {
        open: () => Effect.die("unused"),
      },
    };

    const layer = Layer.empty.pipe(
      Layer.provideMerge(
        WorkspaceFileSystemLive.pipe(
          Layer.provide(WorkspacePathsLive),
          Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
        ),
      ),
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
            id === projectId ? Effect.succeed(remoteExecution) : Effect.die("unknown project"),
        }),
      ),
    );

    const result = yield* Effect.gen(function* () {
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      return yield* workspaceFileSystem.writeFile({
        cwd: remoteRoot,
        relativePath: "plans/effect-rpc.md",
        contents: "# Plan\n",
      });
    }).pipe(Effect.provide(layer));

    assert.equal(result.relativePath, "plans/effect-rpc.md");
    assert.deepEqual(yield* Ref.get(writes), [
      {
        path: "/home/user/repo/plans/effect-rpc.md",
        contents: "# Plan\n",
      },
    ]);
  }),
);
