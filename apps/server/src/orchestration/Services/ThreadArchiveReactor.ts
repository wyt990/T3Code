/**
 * ThreadArchiveReactor - Thread archive cleanup reactor service interface.
 *
 * Reacts to `thread.archived` domain events and stops provider sessions plus
 * terminals so archived threads do not keep consuming runtime resources.
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface ThreadArchiveReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class ThreadArchiveReactor extends Context.Service<
  ThreadArchiveReactor,
  ThreadArchiveReactorShape
>()("t3/orchestration/Services/ThreadArchiveReactor") {}
