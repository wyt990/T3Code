import { ProjectId, type OrchestrationProjectShell } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref } from "effect";

import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeSshTurnStartGateNoopLayer } from "./Layers/SshTurnStartGate.ts";
import { SshConnectionPool } from "./Services/SshConnectionPool.ts";
import {
  hasOtherActiveSshProjectsForConnection,
  releaseIdleSshResourceLanes,
  releaseIdleSshResourceLanesForDeletedProject,
} from "./releaseSshResourceLanes.ts";

const connectionId = "conn-shared";

const makeShellProject = (
  id: string,
  transport: OrchestrationProjectShell["transport"],
  deletedAt: string | null = null,
): OrchestrationProjectShell => ({
  id: ProjectId.make(id),
  title: "project",
  workspaceRoot: "/remote/project",
  transport,
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt,
});

const makeProjectionQueryTestLayer = (
  projects: ReadonlyArray<OrchestrationProjectShell>,
): Layer.Layer<ProjectionSnapshotQuery> => {
  const stub: ProjectionSnapshotQueryShape = {
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.succeed({ projects, threads: [] }),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.die("unused"),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
  };
  return Layer.succeed(ProjectionSnapshotQuery, stub);
};

const makeTrackingPoolLayer = (releasedRef: Ref.Ref<string[]>) =>
  Layer.succeed(SshConnectionPool, {
    acquire: () => Effect.die("unused"),
    invalidate: () => Effect.void,
    releaseIdleLane: (_connectionId, lane) => Ref.update(releasedRef, (lanes) => [...lanes, lane]),
  });

it.effect("releaseIdleSshResourceLanes closes workspace, interactive, and git lanes", () =>
  Effect.gen(function* () {
    const released = yield* Ref.make<string[]>([]);

    yield* releaseIdleSshResourceLanes(connectionId).pipe(
      Effect.provide(makeTrackingPoolLayer(released)),
      Effect.provide(makeSshTurnStartGateNoopLayer()),
    );

    const lanes = yield* Ref.get(released);
    assert.deepEqual(lanes.sort(), ["git", "interactive", "workspace"]);
  }),
);

it.effect(
  "releaseIdleSshResourceLanesForDeletedProject also closes browse/probe when last project",
  () =>
    Effect.gen(function* () {
      const released = yield* Ref.make<string[]>([]);
      const projectId = ProjectId.make("project-a");

      yield* releaseIdleSshResourceLanesForDeletedProject(projectId, connectionId).pipe(
        Effect.provide(makeTrackingPoolLayer(released)),
        Effect.provide(makeSshTurnStartGateNoopLayer()),
        Effect.provide(
          makeProjectionQueryTestLayer([
            makeShellProject(
              "project-a",
              { type: "ssh", sshConnectionId: connectionId },
              "2026-01-02T00:00:00.000Z",
            ),
          ]),
        ),
      );

      const lanes = yield* Ref.get(released);
      assert.deepEqual(lanes.sort(), ["browse", "git", "interactive", "probe", "workspace"]);
    }),
);

it.effect("hasOtherActiveSshProjectsForConnection ignores deleted and same project", () =>
  Effect.gen(function* () {
    const projectA = ProjectId.make("project-a");
    const projectB = ProjectId.make("project-b");

    const hasOther = yield* hasOtherActiveSshProjectsForConnection(connectionId, projectA).pipe(
      Effect.provide(
        makeProjectionQueryTestLayer([
          makeShellProject("project-a", { type: "ssh", sshConnectionId: connectionId }),
          makeShellProject("project-b", { type: "ssh", sshConnectionId: connectionId }),
          makeShellProject("project-local", { type: "local" }),
        ]),
      ),
    );

    assert.equal(hasOther, true);
  }),
);
