import { Effect } from "effect";

import {
  toWorkspaceExecutionError,
  WorkspaceExecutionError,
  type WorkspaceExecutionKind,
} from "../Services/WorkspaceExecution.ts";

export const mapWorkspaceExecutionError =
  (kind: WorkspaceExecutionKind, operation: string) =>
  <A, E>(effect: Effect.Effect<A, E, never>): Effect.Effect<A, WorkspaceExecutionError, never> =>
    effect.pipe(
      Effect.mapError(
        (error): WorkspaceExecutionError =>
          error instanceof WorkspaceExecutionError
            ? error
            : toWorkspaceExecutionError(kind, operation, error),
      ),
    );
