import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceExecutionResolver } from "../../workspace/Services/WorkspaceExecution.ts";

/** Stubs SSH/workspace collaborators for tests that only exercise local git. */
export const GitCoreCollaboratorsTestLive = Layer.mergeAll(
  Layer.succeed(ProjectionSnapshotQuery, {
    getSnapshot: () => Effect.die("unused in GitCore collaborator test stub"),
    getShellSnapshot: () => Effect.die("unused in GitCore collaborator test stub"),
    getCounts: () => Effect.die("unused in GitCore collaborator test stub"),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    getThreadShellById: () => Effect.succeed(Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
  }),
  Layer.succeed(WorkspaceExecutionResolver, {
    resolveByProjectId: () => Effect.die("unused in GitCore collaborator test stub"),
  }),
);
