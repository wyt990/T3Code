import type { Effect } from "effect";
import { Context } from "effect";

/**
 * Reacts to `project.deleted` and releases idle SSH pooled sessions when safe.
 */
export interface ProjectDeletedReactorShape {
  readonly start: () => Effect.Effect<void>;
  readonly drain: () => Effect.Effect<void>;
}

export class ProjectDeletedReactor extends Context.Service<
  ProjectDeletedReactor,
  ProjectDeletedReactorShape
>()("t3/orchestration/Services/ProjectDeletedReactor") {}
