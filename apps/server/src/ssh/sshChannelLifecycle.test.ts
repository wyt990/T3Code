import { EventEmitter } from "node:events";
import { assert, it } from "@effect/vitest";
import { Effect, Option, Queue } from "effect";

import { attachSshChannelLifecycle } from "./sshChannelLifecycle.ts";

/** Minimal ssh2 channel stand-in for lifecycle wiring tests. */
class FakeChannel extends EventEmitter {
  close() {
    this.emit("close", 0);
  }
}

it.effect("closeChannel offers exit code and unblocks exited", () =>
  Effect.gen(function* () {
    const channel = new FakeChannel() as unknown as import("ssh2").ClientChannel;
    const exitQueue = yield* Queue.unbounded<number>();
    let leaseReleases = 0;

    const { closeChannel } = attachSshChannelLifecycle({
      channel,
      exitQueue,
      releaseLease: () =>
        Effect.sync(() => {
          leaseReleases += 1;
        }),
    });

    yield* closeChannel();
    const exitCode = yield* Queue.take(exitQueue);
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(leaseReleases, 1);
  }),
);

it.effect("coalesces duplicate exit signals", () =>
  Effect.gen(function* () {
    const channel = new FakeChannel() as unknown as import("ssh2").ClientChannel;
    const exitQueue = yield* Queue.unbounded<number>();

    attachSshChannelLifecycle({
      channel,
      exitQueue,
      releaseLease: () => Effect.void,
    });

    channel.emit("exit", 42);
    channel.emit("close", 99);

    const first = yield* Queue.take(exitQueue);
    const pending = yield* Queue.poll(exitQueue);
    assert.strictEqual(first, 42);
    assert.strictEqual(Option.isNone(pending), true);
  }),
);
