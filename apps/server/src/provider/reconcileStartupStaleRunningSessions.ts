import { CommandId } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderService } from "./Services/ProviderService.ts";
import { ProviderSessionDirectory } from "./Services/ProviderSessionDirectory.ts";

/**
 * After a full server restart, the persisted read model may still say
 * `session.status === "running"` / `"starting"` while no in-memory provider
 * session exists. Reconcile by dispatching `thread.session.stop` so the UI
 * does not show a bogus “working” state when the external agent is gone.
 */
export const reconcileStartupStaleRunningSessions = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const directory = yield* ProviderSessionDirectory;
  const providerService = yield* ProviderService;

  const readModel = yield* orchestrationEngine.getReadModel();
  const now = new Date().toISOString();

  for (const thread of readModel.threads) {
    if (thread.deletedAt != null) {
      continue;
    }

    const session = thread.session;
    if (!session) {
      continue;
    }
    if (session.status !== "running" && session.status !== "starting") {
      continue;
    }

    const activeThreadIds = new Set((yield* providerService.listSessions()).map((s) => s.threadId));
    if (activeThreadIds.has(thread.id)) {
      continue;
    }

    const bindingOption = yield* directory.getBinding(thread.id);
    const binding = Option.getOrUndefined(bindingOption);

    yield* Effect.logInfo("orchestration.startup.reconcile-stale-running-session", {
      threadId: thread.id,
      persistedSessionStatus: session.status,
      hadProviderBinding: binding !== undefined,
    });

    yield* orchestrationEngine
      .dispatch({
        type: "thread.session.stop",
        commandId: CommandId.make(crypto.randomUUID()),
        threadId: thread.id,
        createdAt: now,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration.startup.reconcile-stale-session-failed", {
            threadId: thread.id,
            cause,
          }),
        ),
      );
  }
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logWarning("orchestration.startup.reconcile-stale-sessions-failed", {
      cause,
    }),
  ),
  Effect.annotateSpans({ "startup.phase": "provider.reconcile-stale-sessions" }),
  Effect.withSpan("server.startup.reconcileStaleRunningSessions"),
);
