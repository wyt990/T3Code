import { readFile } from "node:fs/promises";

import type { ConnectConfig } from "ssh2";
import { Effect, Layer, SynchronizedRef } from "effect";

import { SshConnectionError } from "../Errors.ts";
import { formatSshUserMessage } from "../formatSshUserMessage.ts";
import { defaultSshConnectConfigFields } from "../sshConnectDefaults.ts";
import {
  connectSsh2Client,
  createSsh2Client,
  endSsh2Client,
  isSsh2ClientAlive,
  sshHostKeyFingerprintSha256,
  type Ssh2Client,
} from "../ssh2Adapter.ts";
import { SshConnectionPool, type SshConnectionLease } from "../Services/SshConnectionPool.ts";
import { SshConnectionRegistry } from "../Services/SshConnectionRegistry.ts";
import { SshCredentialResolver } from "../Services/SshCredentialResolver.ts";
import { SshHostKeyVerifier } from "../Services/SshHostKeyVerifier.ts";
import {
  DEFAULT_SSH_CONNECTION_LANE,
  matchesConnectionId,
  resolvePooledConnectionKey,
  type SshConnectionLane,
} from "../sshConnectionLane.ts";

const DEFAULT_IDLE_MS = 60_000;

interface PooledConnection {
  readonly client: Ssh2Client;
  readonly refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

const readPrivateKey = (path: string) =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new SshConnectionError({
        connectionId: "unknown",
        detail: `Failed to read private key at ${path}`,
        cause,
      }),
  });

export const makeSshConnectionPool = (options?: { readonly idleMs?: number }) =>
  Effect.gen(function* () {
    const registry = yield* SshConnectionRegistry;
    const credentials = yield* SshCredentialResolver;
    const hostKeys = yield* SshHostKeyVerifier;
    const poolRef = yield* SynchronizedRef.make(new Map<string, PooledConnection>());
    const idleMs = options?.idleMs ?? DEFAULT_IDLE_MS;
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);

    const closeClient = (connectionId: string, pooled: PooledConnection) =>
      Effect.gen(function* () {
        if (pooled.idleTimer !== undefined) {
          clearTimeout(pooled.idleTimer);
        }
        yield* Effect.tryPromise({
          try: () => endSsh2Client(pooled.client),
          catch: (cause) =>
            new SshConnectionError({
              connectionId,
              detail: "Failed to close SSH client",
              cause,
            }),
        }).pipe(Effect.ignore);
        yield* SynchronizedRef.update(poolRef, (pool) => {
          const next = new Map(pool);
          next.delete(connectionId);
          return next;
        });
      });

    const scheduleIdleClose = (connectionId: string) =>
      SynchronizedRef.update(poolRef, (pool) => {
        const existing = pool.get(connectionId);
        if (existing === undefined || existing.refCount > 0) {
          return pool;
        }
        if (existing.idleTimer !== undefined) {
          clearTimeout(existing.idleTimer);
        }
        const idleTimer = setTimeout(() => {
          void runPromise(closeClient(connectionId, existing));
        }, idleMs);
        const next = new Map(pool);
        next.set(connectionId, { ...existing, idleTimer });
        return next;
      });

    const buildConnectConfig = Effect.fn("SshConnectionPool.buildConnectConfig")(function* (
      connectionId: string,
    ) {
      const connection = yield* registry.getById(connectionId);
      const auth = yield* credentials.resolve(connectionId);

      const config: ConnectConfig = {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        ...defaultSshConnectConfigFields(),
      };

      if (connection.authType === "password") {
        if (auth.password === undefined) {
          return yield* new SshConnectionError({
            connectionId,
            detail: "Password auth selected but no password credential is available.",
          });
        }
        config.password = auth.password;
      }

      if (connection.authType === "privateKey") {
        if (connection.privateKeyPath === undefined) {
          return yield* new SshConnectionError({
            connectionId,
            detail: "privateKey auth selected but privateKeyPath is missing.",
          });
        }
        config.privateKey = yield* readPrivateKey(connection.privateKeyPath).pipe(
          Effect.mapError(
            (error) =>
              new SshConnectionError({
                connectionId,
                detail: error.detail,
                cause: error.cause,
              }),
          ),
        );
        if (auth.passphrase !== undefined) {
          config.passphrase = auth.passphrase;
        }
      }

      if (connection.authType === "agent") {
        const agentSocket = process.env.SSH_AUTH_SOCK;
        if (agentSocket === undefined || agentSocket.length === 0) {
          return yield* new SshConnectionError({
            connectionId,
            detail: "SSH agent auth selected but SSH_AUTH_SOCK is not set.",
          });
        }
        config.agent = agentSocket;
      }

      return { connection, config } as const;
    });

    const attachClientDisconnectHandler = (
      pooledKey: string,
      logicalConnectionId: string,
      client: Ssh2Client,
    ) => {
      const handleDisconnect = () => {
        void runPromise(
          Effect.gen(function* () {
            yield* SynchronizedRef.update(poolRef, (pool) => {
              const current = pool.get(pooledKey);
              if (current?.client !== client) {
                return pool;
              }
              const next = new Map(pool);
              next.delete(pooledKey);
              return next;
            });
            yield* registry
              .recordConnectionResult({
                connectionId: logicalConnectionId,
                ok: false,
                error: "SSH 连接已断开，下次操作将自动重连。",
              })
              .pipe(
                Effect.catchTag("SshConnectionNotFoundError", () => Effect.void),
                Effect.ignore,
              );
          }),
        );
      };

      client.once("close", handleDisconnect);
      client.once("error", handleDisconnect);
    };

    const connect = Effect.fn("SshConnectionPool.connect")(function* (connectionId: string) {
      const { connection, config: baseConfig } = yield* buildConnectConfig(connectionId);
      const client = createSsh2Client();

      const connectConfig: ConnectConfig = {
        ...baseConfig,
        hostVerifier: (key: Buffer) => {
          const fingerprint = sshHostKeyFingerprintSha256(key);
          const expected = hostKeys.fingerprintForHost({
            host: connection.host,
            port: connection.port,
          });
          if (expected === undefined) {
            return false;
          }
          return expected === fingerprint;
        },
      };

      yield* Effect.tryPromise({
        try: () => connectSsh2Client(client, { config: connectConfig }),
        catch: (error) =>
          new SshConnectionError({
            connectionId,
            detail: formatSshUserMessage(error),
            cause: error,
          }),
      });

      return client;
    });

    const acquire: (typeof SshConnectionPool)["Service"]["acquire"] = Effect.fn(
      "SshConnectionPool.acquire",
    )(function* (connectionId, options) {
      const lane: SshConnectionLane = options?.lane ?? DEFAULT_SSH_CONNECTION_LANE;
      const pooledKey = resolvePooledConnectionKey(connectionId, lane);

      const existing = yield* SynchronizedRef.get(poolRef).pipe(
        Effect.map((pool) => {
          const result = pool.get(pooledKey);
          if (result !== undefined) {
            // Removed: yield* cannot be used outside Effect.gen function
            // logDebug("[SshConnectionPool] found existing connection", {
            //   connectionId,
            //   refCount: result.refCount,
            //   hasIdleTimer: result.idleTimer !== undefined,
            //   isAlive: isSsh2ClientAlive(result.client),
            // });
          }
          return result;
        }),
      );

      if (existing !== undefined) {
        const isAlive = isSsh2ClientAlive(existing.client);
        // Removed: yield* cannot be used outside Effect.gen function
        // logDebug("[SshConnectionPool] checking existing connection health", {
        //   connectionId,
        //   refCount: existing.refCount,
        //   isAlive,
        // });

        if (!isAlive) {
          // Removed: yield* cannot be used outside Effect.gen function
          // logInfo("[SshConnectionPool] closing stale connection", { connectionId });
          yield* closeClient(pooledKey, existing);
        }
      }

      const pooledAfterStaleClose = yield* SynchronizedRef.get(poolRef).pipe(
        Effect.map((pool) => {
          const result = pool.get(pooledKey);
          if (result !== undefined) {
            // Removed: yield* cannot be used outside Effect.gen function
            // logDebug("[SshConnectionPool] after stale close", {
            //   connectionId,
            //   refCount: result.refCount,
            //   isAlive: isSsh2ClientAlive(result.client),
            // });
          }
          return result;
        }),
      );

      // Removed: yield* cannot be used outside Effect.gen function
      // logDebug("[SshConnectionPool] determining connection to use", {
      //   connectionId,
      //   hasPooled: pooledAfterStaleClose !== undefined,
      //   isPooledAlive: pooledAfterStaleClose !== undefined && isSsh2ClientAlive(pooledAfterStaleClose.client),
      // });

      const client =
        pooledAfterStaleClose !== undefined && isSsh2ClientAlive(pooledAfterStaleClose.client)
          ? pooledAfterStaleClose.client
          : yield* connect(connectionId).pipe(
              Effect.tap((connectedClient) => {
                attachClientDisconnectHandler(pooledKey, connectionId, connectedClient);
                return SynchronizedRef.update(poolRef, (pool) => {
                  const next = new Map(pool);
                  next.set(pooledKey, {
                    client: connectedClient,
                    refCount: 0,
                    idleTimer: undefined,
                  });
                  return next;
                });
              }),
            );

      // Removed: yield* cannot be used outside Effect.gen function
      // logDebug("[SshConnectionPool] updating refCount", {
      //   connectionId,
      //   hasCurrent: pool.get(connectionId) !== undefined,
      //   oldRefCount: pool.get(connectionId)?.refCount ?? 0,
      // });

      yield* SynchronizedRef.update(poolRef, (pool) => {
        const current = pool.get(pooledKey);
        if (current === undefined) {
          const next = new Map(pool);
          next.set(pooledKey, {
            client,
            refCount: 1,
            idleTimer: undefined,
          });
          return next;
        }
        if (current.idleTimer !== undefined) {
          clearTimeout(current.idleTimer);
        }
        const next = new Map(pool);
        next.set(pooledKey, {
          ...current,
          client,
          refCount: current.refCount + 1,
          idleTimer: undefined,
        });
        // Removed: yield* cannot be used outside Effect.gen function
        // logDebug("[SshConnectionPool] refCount updated", {
        //   connectionId,
        //   newRefCount: next.get(connectionId)?.refCount ?? 0,
        // });
        return next;
      });

      const release = () =>
        Effect.gen(function* () {
          yield* Effect.logInfo("[SshConnectionPool] release called", {
            connectionId,
            lane,
            pooledKey,
          });

          const pooled = yield* SynchronizedRef.modify(poolRef, (pool) => {
            const current = pool.get(pooledKey);
            if (current === undefined) {
              return [undefined, pool] as const;
            }
            const refCount = Math.max(0, current.refCount - 1);
            const next = new Map(pool);
            next.set(pooledKey, { ...current, refCount, idleTimer: current.idleTimer });
            return [next.get(pooledKey), next] as const;
          });
          if (pooled !== undefined && pooled.refCount === 0) {
            yield* scheduleIdleClose(pooledKey);
          }
        });

      yield* Effect.logInfo("[SshConnectionPool] returning lease", {
        connectionId,
        lane,
        pooledKey,
      });

      return {
        connectionId,
        lane,
        pooledKey,
        client,
        release,
      } satisfies SshConnectionLease;
    });

    const invalidate = (connectionId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const pool = yield* SynchronizedRef.get(poolRef);
        for (const [pooledKey, pooled] of pool.entries()) {
          if (matchesConnectionId(pooledKey, connectionId)) {
            yield* closeClient(pooledKey, pooled);
          }
        }
      });

    return { acquire, invalidate } satisfies (typeof SshConnectionPool)["Service"];
  });

export const SshConnectionPoolLive = Layer.effect(SshConnectionPool, makeSshConnectionPool());

export const makeSshConnectionPoolTestLayer = (options: {
  readonly clients: Readonly<Record<string, Ssh2Client>>;
  readonly idleMs?: number;
}) =>
  Layer.succeed(SshConnectionPool, {
    acquire: (connectionId, acquireOptions) => {
      const lane = acquireOptions?.lane ?? DEFAULT_SSH_CONNECTION_LANE;
      const pooledKey = resolvePooledConnectionKey(connectionId, lane);
      const client = options.clients[pooledKey] ?? options.clients[connectionId];
      return client === undefined
        ? Effect.fail(
            new SshConnectionError({
              connectionId,
              detail: "No mock SSH client configured for connection id.",
            }),
          )
        : Effect.succeed({
            connectionId,
            lane,
            pooledKey,
            client,
            release: () => Effect.void,
          });
    },
    invalidate: () => Effect.void,
  });
