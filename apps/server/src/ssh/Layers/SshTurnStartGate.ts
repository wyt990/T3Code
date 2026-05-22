import { Effect, Layer, Semaphore, SynchronizedRef } from "effect";

import { SshTurnStartGate, type SshTurnStartGateShape } from "../Services/SshTurnStartGate.ts";

export const makeSshTurnStartGate = Effect.gen(function* () {
  const gatesRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());

  const getGate = (connectionId: string) =>
    Effect.gen(function* () {
      const existing = yield* SynchronizedRef.get(gatesRef).pipe(
        Effect.map((map) => map.get(connectionId)),
      );
      if (existing !== undefined) {
        return existing;
      }

      const created = yield* Semaphore.make(1);
      return yield* SynchronizedRef.modify(gatesRef, (map) => {
        const current = map.get(connectionId);
        if (current !== undefined) {
          return [current, map] as const;
        }
        const next = new Map(map);
        next.set(connectionId, created);
        return [created, next] as const;
      });
    });

  const withExclusive: SshTurnStartGateShape["withExclusive"] = (connectionId, effect) =>
    Effect.gen(function* () {
      const gate = yield* getGate(connectionId);
      return yield* gate.withPermit(effect);
    });

  const invalidate: SshTurnStartGateShape["invalidate"] = (connectionId) =>
    SynchronizedRef.update(gatesRef, (map) => {
      const next = new Map(map);
      next.delete(connectionId);
      return next;
    });

  return { withExclusive, invalidate } satisfies SshTurnStartGateShape;
});

export const SshTurnStartGateLive = Layer.effect(SshTurnStartGate, makeSshTurnStartGate);

export const makeSshTurnStartGateNoopLayer = () =>
  Layer.succeed(SshTurnStartGate, {
    withExclusive: (_connectionId, effect) => effect,
    invalidate: () => Effect.void,
  });
