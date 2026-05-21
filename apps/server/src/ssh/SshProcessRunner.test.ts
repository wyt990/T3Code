import { PassThrough } from "node:stream";

import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Client, ClientChannel } from "ssh2";

import { makeSshConnectionPoolTestLayer } from "./Layers/SshConnectionPool.ts";
import { SshProcessRunnerLive } from "./Layers/SshProcessRunner.ts";
import { SshProcessRunner } from "./Services/SshProcessRunner.ts";

const makeExecChannel = (stdout: string, exitCode = 0): ClientChannel => {
  const channel = new PassThrough() as unknown as ClientChannel;
  const stderr = new PassThrough();
  (channel as ClientChannel & { stderr: PassThrough }).stderr = stderr;
  queueMicrotask(() => {
    channel.emit("data", Buffer.from(stdout));
    stderr.emit("data", Buffer.from(""));
    channel.emit("exit", exitCode);
    channel.emit("close");
  });
  return channel;
};

const mockClient = {
  destroyed: false,
  exec: (
    command: string,
    _options: unknown,
    callback: (error: Error | undefined, channel?: ClientChannel) => void,
  ) => {
    const stdout = command.includes("ls") ? "remote.txt\n" : "ok\n";
    callback(undefined, makeExecChannel(stdout));
  },
  end: () => undefined,
  on: () => undefined,
  once: () => undefined,
} as unknown as Client;

const TestLayer = it.layer(
  SshProcessRunnerLive.pipe(
    Layer.provide(
      makeSshConnectionPoolTestLayer({
        clients: {
          "conn-1": mockClient,
        },
      }),
    ),
  ),
);

TestLayer("SshProcessRunner", (it) => {
  it.effect("runs remote exec and returns stdout", () =>
    Effect.gen(function* () {
      const runner = yield* SshProcessRunner;
      const result = yield* runner.exec({
        connectionId: "conn-1",
        command: "ls",
        cwd: "/tmp/project",
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /remote\.txt/);
    }),
  );
});
