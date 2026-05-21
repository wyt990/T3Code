import { ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { OpenLive, resolveEditorLaunch } from "./open.ts";
import { parseOpenEditorTarget } from "./openEditorTargetParse.ts";
import { materializeRemoteOpenTarget } from "./openRemoteWorkspace.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
} from "./workspace/Services/WorkspaceExecution.ts";
import { resolveWorkspaceExecutionForTargetPath } from "./workspace/resolveWorkspaceExecutionByCwd.ts";

const remoteRoot = "/home/user/repo";

const makeRemoteExecution = (): WorkspaceExecution => ({
  kind: "ssh",
  workspaceRoot: remoteRoot,
  sshConnectionId: "conn-open-1",
  spawnInteractive: () => Effect.die("unused"),
  exec: () => Effect.die("unused"),
  fileSystem: {
    list: () => Effect.die("unused"),
    stat: (targetPath) =>
      Effect.succeed({
        path: targetPath,
        isDirectory: targetPath === remoteRoot,
        size: targetPath === remoteRoot ? 0 : 42,
      }),
    readFileBytes: () => Effect.die("unused"),
    readFileString: (targetPath) =>
      targetPath === `${remoteRoot}/src/app.ts`
        ? Effect.succeed("export const app = 1;\n")
        : Effect.die(`unexpected read: ${targetPath}`),
    writeFileString: () => Effect.die("unused"),
    makeDirectory: () => Effect.die("unused"),
  },
  terminal: {
    open: () => Effect.die("unused"),
  },
});

const mockProjection: ProjectionSnapshotQueryShape = {
  getSnapshot: () => Effect.die("unused"),
  getShellSnapshot: () =>
    Effect.succeed({
      snapshotSequence: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      projects: [
        {
          id: ProjectId.make("project-ssh-open"),
          title: "Remote",
          workspaceRoot: remoteRoot,
          transport: { type: "ssh", sshConnectionId: "conn-open-1" },
          repositoryIdentity: null,
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      threads: [],
    }),
  getCounts: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
  getProjectShellById: () => Effect.succeed(Option.none()),
  getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
  getThreadCheckpointContext: () => Effect.succeed(Option.none()),
  getThreadShellById: () => Effect.succeed(Option.none()),
  getThreadDetailById: () => Effect.succeed(Option.none()),
};

it.effect("resolveWorkspaceExecutionForTargetPath matches nested remote file paths", () =>
  Effect.gen(function* () {
    const execution = yield* resolveWorkspaceExecutionForTargetPath(
      `${remoteRoot}/src/app.ts:12:3`,
      {
        projectionSnapshotQuery: mockProjection,
        workspaceExecutionResolver: {
          resolveByProjectId: () => Effect.succeed(makeRemoteExecution()),
        },
      },
    );
    const resolved = Option.getOrThrow(execution);
    assert.equal(resolved.workspaceRoot, remoteRoot);
  }),
);

it.effect("materializeRemoteOpenTarget writes local temp file with line suffix", () =>
  Effect.gen(function* () {
    const localTarget = yield* materializeRemoteOpenTarget(
      `${remoteRoot}/src/app.ts:12:3`,
      makeRemoteExecution(),
    );
    assert.match(localTarget, /:12:3$/);
    assert.include(localTarget, "app.ts");
    const localPath = parseOpenEditorTarget(localTarget).path;
    const content = yield* Effect.promise(async () => {
      const { readFile } = await import("node:fs/promises");
      return readFile(localPath, "utf8");
    });
    assert.include(content, "export const app");
  }),
);

it.effect("materializeRemoteOpenTarget rejects remote directories", () =>
  Effect.gen(function* () {
    const result = yield* materializeRemoteOpenTarget(remoteRoot, makeRemoteExecution()).pipe(
      Effect.result,
    );
    assert.equal(result._tag, "Failure");
  }),
);

const OpenSshLayer = Layer.empty.pipe(
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, mockProjection)),
  Layer.provideMerge(
    Layer.succeed(WorkspaceExecutionResolver, {
      resolveByProjectId: () => Effect.succeed(makeRemoteExecution()),
    }),
  ),
);

it.layer(OpenSshLayer)("Open SSH integration", (it) => {
  it.effect("openInEditor resolves editor launch for materialized remote file", () =>
    Effect.gen(function* () {
      const launch = yield* resolveEditorLaunch(
        {
          cwd: yield* materializeRemoteOpenTarget(
            `${remoteRoot}/src/app.ts:5`,
            makeRemoteExecution(),
          ),
          editor: "cursor",
        },
        "linux",
        { PATH: "" },
      );
      assert.equal(launch.command, "cursor");
      assert.include(launch.args.join(" "), "app.ts");
    }),
  );
});
