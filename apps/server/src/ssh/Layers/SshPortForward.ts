import * as Net from "node:net";

import { Effect, Layer } from "effect";
import { NetService } from "@t3tools/shared/Net";

import { SshConnectionError } from "../Errors.ts";
import { SshConnectionPool } from "../Services/SshConnectionPool.ts";
import {
  SshPortForward,
  type SshPortForwardHandle,
  type SshPortForwardTarget,
} from "../Services/SshPortForward.ts";

const DEFAULT_LOCAL_HOST = "127.0.0.1";

const closeServer = (server: Net.Server) =>
  Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    catch: () => undefined,
  }).pipe(Effect.ignore);

export const makeSshPortForward = Effect.gen(function* () {
  const pool = yield* SshConnectionPool;
  const netService = yield* NetService;

  const acquireForward = Effect.fn("SshPortForward.acquireForward")(function* (
    connectionId: string,
    target: SshPortForwardTarget,
  ) {
    const localHost = target.localHost ?? DEFAULT_LOCAL_HOST;
    const localPort = yield* netService.findAvailablePort(0).pipe(
      Effect.mapError(
        (cause) =>
          new SshConnectionError({
            connectionId,
            detail: `Failed to reserve local port for SSH forward: ${cause.message}`,
            cause,
          }),
      ),
    );

    const lease = yield* pool.acquire(connectionId, { lane: target.lane ?? "probe" });

    const server = yield* Effect.tryPromise({
      try: () =>
        new Promise<Net.Server>((resolve, reject) => {
          const next = Net.createServer((socket) => {
            lease.client.forwardOut(
              socket.remoteAddress ?? DEFAULT_LOCAL_HOST,
              socket.remotePort ?? 0,
              target.remoteHost,
              target.remotePort,
              (error, stream) => {
                if (error !== undefined) {
                  socket.destroy();
                  return;
                }
                socket.pipe(stream).pipe(socket);
              },
            );
          });
          next.once("error", reject);
          next.listen(localPort, localHost, () => resolve(next));
        }),
      catch: (cause) =>
        new SshConnectionError({
          connectionId,
          detail: `SSH port forward failed: ${
            cause instanceof Error
              ? cause.message
              : typeof cause === "string"
                ? cause
                : "unknown error"
          }`,
          cause,
        }),
    }).pipe(Effect.tapError(() => lease.release()));

    const handle: SshPortForwardHandle = {
      localHost,
      localPort,
      localUrl: `http://${localHost}:${localPort}`,
      release: () =>
        Effect.gen(function* () {
          yield* closeServer(server);
          yield* lease.release();
        }),
    };

    return handle;
  });

  return { acquireForward } satisfies (typeof SshPortForward)["Service"];
});

export const SshPortForwardLive = Layer.effect(SshPortForward, makeSshPortForward);

export const makeSshPortForwardTestLayer = (options: {
  readonly acquireForward: (typeof SshPortForward)["Service"]["acquireForward"];
}) => Layer.succeed(SshPortForward, { acquireForward: options.acquireForward });
