import type { ClientChannel } from "ssh2";
import { Effect, Queue } from "effect";

const exitCodeFromCloseArgs = (args: ReadonlyArray<unknown>): number =>
  typeof args[0] === "number" ? args[0] : 0;

/** Wire ssh2 channel exit/close events to an exit queue and a single lease release. */
export const attachSshChannelLifecycle = (input: {
  readonly channel: ClientChannel;
  readonly exitQueue: Queue.Queue<number, never>;
  readonly releaseLease: () => Effect.Effect<void>;
}) => {
  let exitRecorded = false;
  let leaseReleased = false;

  const offerExit = (code: number) =>
    Effect.gen(function* () {
      if (exitRecorded) {
        return;
      }
      exitRecorded = true;
      yield* Queue.offer(input.exitQueue, code);
    });

  const releaseLeaseOnce = () =>
    leaseReleased
      ? Effect.void
      : Effect.gen(function* () {
          leaseReleased = true;
          yield* input.releaseLease();
        });

  input.channel.on("exit", (code: number) => {
    void offerExit(typeof code === "number" ? code : 1).pipe(Effect.runPromise);
  });

  input.channel.on("close", (...args: unknown[]) => {
    void offerExit(exitCodeFromCloseArgs(args)).pipe(
      Effect.andThen(releaseLeaseOnce),
      Effect.runPromise,
    );
  });

  const closeChannel = () =>
    Effect.gen(function* () {
      input.channel.close();
      yield* offerExit(0);
      yield* releaseLeaseOnce();
    });

  return { closeChannel, offerExit, releaseLeaseOnce };
};
