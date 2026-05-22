import { assert, it } from "@effect/vitest";
import { Effect, Ref } from "effect";

import { makeSshTurnStartGate } from "./SshTurnStartGate.ts";

it.effect("withExclusive runs turn-start effects sequentially per connection", () =>
  Effect.gen(function* () {
    const gate = yield* makeSshTurnStartGate;
    const order = yield* Ref.make<Array<string>>([]);

    yield* gate.withExclusive(
      "conn-a",
      Ref.update(order, (entries) => [...entries, "first"]),
    );
    yield* gate.withExclusive(
      "conn-a",
      Ref.update(order, (entries) => [...entries, "second"]),
    );

    const result = yield* Ref.get(order);
    assert.deepEqual(result, ["first", "second"]);
  }),
);
