import { Effect, Layer, Option } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceExecutionResolver } from "./Services/WorkspaceExecution.ts";

/** Stubs orchestration/workspace collaborators for workspace layer unit tests. */
export const WorkspaceCollaboratorsTestLive = Layer.mergeAll(
  Layer.succeed(ProjectionSnapshotQuery, {
    getSnapshot: () => Effect.die("unused in workspace collaborator test stub"),
    getShellSnapshot: () => Effect.die("unused in workspace collaborator test stub"),
    getCounts: () => Effect.die("unused in workspace collaborator test stub"),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    getThreadShellById: () => Effect.succeed(Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
  }),
  Layer.succeed(WorkspaceExecutionResolver, {
    resolveByProjectId: () => Effect.die("unused in workspace collaborator test stub"),
  }),
);
