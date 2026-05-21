import { PassThrough } from "node:stream";

import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Client, ClientChannel } from "ssh2";
import { makeSshConnectionPoolTestLayer } from "./Layers/SshConnectionPool.ts";
import { SshConnectionPool } from "./Services/SshConnectionPool.ts";

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

const makeMockClient = (stdout: string): Client =>
  ({
    destroyed: false,
    exec: (
      _command: string,
      _options: unknown,
      callback: (error: Error | undefined, channel?: ClientChannel) => void,
    ) => {
      callback(undefined, makeExecChannel(stdout));
    },
    sftp: (callback: (error: Error | undefined, sftp?: unknown) => void) => {
      callback(undefined, {
        readdir: (
          _path: string,
          cb: (
            error: Error | undefined,
            list?: Array<{
              filename: string;
              attrs: { isDirectory: () => boolean; isSymbolicLink: () => boolean };
            }>,
          ) => void,
        ) => {
          cb(undefined, [
            {
              filename: "README.md",
              attrs: {
                isDirectory: () => false,
                isSymbolicLink: () => false,
              },
            },
          ]);
        },
        stat: (
          _path: string,
          cb: (
            error: Error | undefined,
            attrs?: { isDirectory: () => boolean; size: number },
          ) => void,
        ) => {
          cb(undefined, {
            isDirectory: () => false,
            size: 12,
          });
        },
      });
    },
    end: () => undefined,
    on: () => undefined,
    once: () => undefined,
  }) as unknown as Client;

const TestLayer = it.layer(
  makeSshConnectionPoolTestLayer({
    clients: {
      "conn-1": makeMockClient("listed-a\n"),
      "conn-2": makeMockClient("listed-b\n"),
    },
  }),
);

TestLayer("SshConnectionPool", (it) => {
  it.effect("acquires and releases pooled clients", () =>
    Effect.gen(function* () {
      const pool = yield* SshConnectionPool;
      const lease = yield* pool.acquire("conn-1");
      assert.equal(lease.connectionId, "conn-1");
      yield* lease.release();
    }),
  );

  it.effect("acquires multiple connections in parallel without cross-talk", () =>
    Effect.gen(function* () {
      const pool = yield* SshConnectionPool;
      const [leaseA, leaseB] = yield* Effect.all([pool.acquire("conn-1"), pool.acquire("conn-2")]);
      assert.equal(leaseA.connectionId, "conn-1");
      assert.equal(leaseB.connectionId, "conn-2");
      assert.notStrictEqual(leaseA.client, leaseB.client);
      yield* Effect.all([leaseA.release(), leaseB.release()]);
    }),
  );
});
