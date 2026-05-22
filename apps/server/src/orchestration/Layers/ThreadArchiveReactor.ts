import { CommandId, type OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { Cause, Effect, Layer, Stream } from "effect";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadArchiveReactor,
  type ThreadArchiveReactorShape,
} from "../Services/ThreadArchiveReactor.ts";
import { logCleanupCauseUnlessInterrupted } from "./ThreadDeletionReactor.ts";

type ThreadArchivedEvent = Extract<OrchestrationEvent, { type: "thread.archived" }>;

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const terminalManager = yield* TerminalManager;

  const stopProviderSession = (threadId: ThreadArchivedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: providerService.stopSession({ threadId }),
      message: "thread archive cleanup skipped provider session stop",
      threadId,
    });

  const dispatchSessionStop = (event: ThreadArchivedEvent) =>
    logCleanupCauseUnlessInterrupted({
      effect: orchestrationEngine.dispatch({
        type: "thread.session.stop",
        commandId: CommandId.make(`session-stop-for-archive:${event.commandId}`),
        threadId: event.payload.threadId,
        createdAt: new Date().toISOString(),
      }),
      message: "thread archive cleanup skipped orchestration session stop",
      threadId: event.payload.threadId,
    });

  const closeThreadTerminals = (threadId: ThreadArchivedEvent["payload"]["threadId"]) =>
    logCleanupCauseUnlessInterrupted({
      effect: terminalManager.close({ threadId }),
      message: "thread archive cleanup skipped terminal close",
      threadId,
    });

  const processThreadArchived = Effect.fn("processThreadArchived")(function* (
    event: ThreadArchivedEvent,
  ) {
    const { threadId } = event.payload;
    yield* stopProviderSession(threadId);
    yield* dispatchSessionStop(event);
    yield* closeThreadTerminals(threadId);
  });

  const processThreadArchivedSafely = (event: ThreadArchivedEvent) =>
    processThreadArchived(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("thread archive reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processThreadArchivedSafely);

  const start: ThreadArchiveReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.archived") {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ThreadArchiveReactorShape;
});

export const ThreadArchiveReactorLive = Layer.effect(ThreadArchiveReactor, make);
