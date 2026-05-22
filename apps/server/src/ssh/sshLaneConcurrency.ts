import { Effect, Semaphore, SynchronizedRef } from "effect";

import type { SshLaneConcurrencyShape } from "./Services/SshLaneConcurrency.ts";
import { resolvePooledConnectionKey, type SshConnectionLane } from "./sshConnectionLane.ts";

/** Max concurrent ssh2 exec/spawn channels per (connectionId, lane) TCP session. */
export const SSH_LANE_MAX_CONCURRENT_CHANNELS: Record<SshConnectionLane, number> = {
  probe: 1,
  git: 4,
  workspace: 2,
  interactive: 2,
  browse: 2,
};

export const makeSshLaneConcurrency = (): Effect.Effect<SshLaneConcurrencyShape> =>
  Effect.gen(function* () {
    const semaphoresRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());

    const getSemaphore = (connectionId: string, lane: SshConnectionLane) =>
      Effect.gen(function* () {
        const pooledKey = resolvePooledConnectionKey(connectionId, lane);
        const existing = yield* SynchronizedRef.get(semaphoresRef).pipe(
          Effect.map((map) => map.get(pooledKey)),
        );
        if (existing !== undefined) {
          return existing;
        }

        const permits = SSH_LANE_MAX_CONCURRENT_CHANNELS[lane];
        const created = yield* Semaphore.make(permits);
        return yield* SynchronizedRef.modify(semaphoresRef, (map) => {
          const current = map.get(pooledKey);
          if (current !== undefined) {
            return [current, map] as const;
          }
          const next = new Map(map);
          next.set(pooledKey, created);
          return [created, next] as const;
        });
      });

    const withLanePermit = <A, E, R>(
      connectionId: string,
      lane: SshConnectionLane,
      effect: Effect.Effect<A, E, R>,
    ) =>
      Effect.gen(function* () {
        const semaphore = yield* getSemaphore(connectionId, lane);
        return yield* semaphore.withPermit(effect);
      });

    return { withLanePermit } satisfies SshLaneConcurrencyShape;
  });

let sharedLaneConcurrency: SshLaneConcurrencyShape | undefined;

/** One semaphore map per process; used by runner + filesystem without a separate Layer service. */
export const sharedSshLaneConcurrency = (): Effect.Effect<SshLaneConcurrencyShape> =>
  Effect.sync(() => {
    if (sharedLaneConcurrency === undefined) {
      sharedLaneConcurrency = Effect.runSync(makeSshLaneConcurrency());
    }
    return sharedLaneConcurrency;
  });
