import { assert, it } from "@effect/vitest";
import { Effect, Ref } from "effect";

import { SSH_LANE_MAX_CONCURRENT_CHANNELS, makeSshLaneConcurrency } from "./sshLaneConcurrency.ts";

it.effect("withLanePermit limits concurrent exec on the same lane", () =>
  Effect.gen(function* () {
    const concurrency = yield* makeSshLaneConcurrency();
    const active = yield* Ref.make(0);
    const maxActive = yield* Ref.make(0);

    const bump = Effect.gen(function* () {
      const next = yield* Ref.updateAndGet(active, (n) => n + 1);
      yield* Ref.update(maxActive, (current) => Math.max(current, next));
      yield* Ref.update(active, (n) => n - 1);
    });

    const permits = SSH_LANE_MAX_CONCURRENT_CHANNELS.probe;
    yield* Effect.forEach(
      Array.from({ length: 4 }, (_, index) => index),
      () => concurrency.withLanePermit("conn-1", "probe", bump),
      { concurrency: 4 },
    );

    const peak = yield* Ref.get(maxActive);
    assert.equal(peak, permits);
  }),
);
