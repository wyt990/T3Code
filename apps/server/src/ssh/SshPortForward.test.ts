import * as Net from "node:net";
import { PassThrough } from "node:stream";

import { assert, it } from "@effect/vitest";
import type { ClientChannel } from "ssh2";
import { Effect, Layer } from "effect";
import { NetService } from "@t3tools/shared/Net";

import { SshPortForwardLive } from "./Layers/SshPortForward.ts";
import { makeSshConnectionPoolTestLayer } from "./Layers/SshConnectionPool.ts";
import { SshPortForward } from "./Services/SshPortForward.ts";
import type { Ssh2Client } from "./ssh2Adapter.ts";

const mockForwardStream = (): ClientChannel => new PassThrough() as unknown as ClientChannel;

const mockClient: Ssh2Client = {
  forwardOut: (_srcIP, _srcPort, dstIP, dstPort, callback) => {
    assert.strictEqual(dstIP, "127.0.0.1");
    assert.strictEqual(dstPort, 4096);
    callback?.(undefined, mockForwardStream());
  },
} as Ssh2Client;

const TestLayer = it.layer(
  Layer.provide(
    SshPortForwardLive,
    Layer.mergeAll(
      NetService.layer,
      makeSshConnectionPoolTestLayer({ clients: { "conn-1": mockClient } }),
    ),
  ),
);

TestLayer("SshPortForward", (it) => {
  it.effect("acquireForward returns local URL and release closes listener", () =>
    Effect.gen(function* () {
      const portForward = yield* SshPortForward;
      const handle = yield* portForward.acquireForward("conn-1", {
        remoteHost: "127.0.0.1",
        remotePort: 4096,
      });
      assert.match(handle.localUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.strictEqual(handle.localPort > 0, true);

      const connected = yield* Effect.promise(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const socket = Net.connect(handle.localPort, handle.localHost);
            socket.once("connect", () => {
              socket.end();
              resolve(true);
            });
            socket.once("error", reject);
          }),
      );
      assert.strictEqual(connected, true);
      yield* handle.release();
    }),
  );
});
