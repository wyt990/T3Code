import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { ProviderSessionDirectory } from "./provider/Services/ProviderSessionDirectory.ts";
import { ProviderAdapterRegistry } from "./provider/Services/ProviderAdapterRegistry.ts";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService.ts";

/**
 * POST /shutdown
 *
 * Gracefully stops all provider sessions (writing JSONL result entries so
 * --resume works after restart) and flushes analytics before responding.
 *
 * Called by the desktop app before SIGTERM so the server can clean up on
 * Windows where SIGTERM = TerminateProcess (instant kill, no signal handler).
 */
export const serverShutdownRouteLayer = HttpRouter.add(
  "POST",
  "/shutdown",
  Effect.gen(function* () {
    const directory = yield* ProviderSessionDirectory;
    const registry = yield* ProviderAdapterRegistry;
    const analytics = yield* AnalyticsService;

    // Stop all adapter sessions — this triggers stopSessionInternal on each
    // session which appends the synthetic "result" entry to the .jsonl file.
    const providers = yield* registry.listProviders();
    const adapters = yield* Effect.forEach(providers, (provider) =>
      registry.getByProvider(provider),
    );
    yield* Effect.forEach(adapters, (adapter) => adapter.stopAll(), { discard: true });

    // Mark persisted runtime bindings as stopped.
    const threadIds = yield* directory.listThreadIds();
    yield* Effect.forEach(
      threadIds,
      (threadId) =>
        Effect.gen(function* () {
          const provider = yield* directory.getProvider(threadId);
          yield* directory.upsert({
            threadId,
            provider,
            status: "stopped",
            runtimePayload: {
              activeTurnId: null,
              lastRuntimeEvent: "server.shutdown",
              lastRuntimeEventAt: new Date().toISOString(),
            },
          });
        }).pipe(Effect.catch(() => Effect.void)),
      { discard: true },
    );

    yield* analytics.flush;

    return HttpServerResponse.jsonUnsafe({ status: "ok" }, { status: 200 });
  }),
);
