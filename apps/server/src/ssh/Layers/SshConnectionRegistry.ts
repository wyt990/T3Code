import { randomUUID } from "node:crypto";

import type { SshConnectionConfig, SshConnectionSummary } from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Schema } from "effect";

import { ServerConfig } from "../../config.ts";
import { SshConnectionNotFoundError } from "../Errors.ts";
import { SshConnectionRegistry } from "../Services/SshConnectionRegistry.ts";

const SshConnectionsFile = Schema.Struct({
  connections: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      host: Schema.String,
      port: Schema.Number,
      username: Schema.String,
      authType: Schema.Literals(["password", "privateKey", "agent"]),
      privateKeyPath: Schema.optional(Schema.String),
      label: Schema.String,
      status: Schema.Literals(["disconnected", "connecting", "connected", "error"]),
      lastConnectedAt: Schema.optional(Schema.String),
      lastError: Schema.optional(Schema.String),
      createdAt: Schema.String,
      updatedAt: Schema.String,
    }),
  ),
});

const emptyFile = { connections: [] as const };

const toConnectionSummary = (connection: SshConnectionConfig): SshConnectionSummary => ({
  id: connection.id,
  host: connection.host,
  port: connection.port,
  username: connection.username,
  label: connection.label,
  authType: connection.authType,
  ...(connection.privateKeyPath === undefined ? {} : { privateKeyPath: connection.privateKeyPath }),
  status: connection.status,
  ...(connection.lastConnectedAt === undefined
    ? {}
    : { lastConnectedAt: connection.lastConnectedAt }),
  ...(connection.lastError === undefined ? {} : { lastError: connection.lastError }),
});

export const makeSshConnectionRegistry = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig;

  const filePath = `${config.stateDir}/ssh-connections.json`;

  const readConnectionsFile = Effect.gen(function* () {
    const exists = yield* fileSystem.exists(filePath);
    if (!exists) {
      return emptyFile.connections as ReadonlyArray<SshConnectionConfig>;
    }
    const contents = yield* fileSystem.readFileString(filePath);
    if (contents.trim().length === 0) {
      return emptyFile.connections as ReadonlyArray<SshConnectionConfig>;
    }
    const decoded = yield* Schema.decodeUnknownEffect(SshConnectionsFile)(JSON.parse(contents));
    return decoded.connections as ReadonlyArray<SshConnectionConfig>;
  }).pipe(Effect.orDie);

  const writeConnectionsFile = (connections: ReadonlyArray<SshConnectionConfig>) =>
    fileSystem
      .writeFileString(filePath, `${JSON.stringify({ connections }, null, 2)}\n`)
      .pipe(Effect.orDie);

  const getById: (typeof SshConnectionRegistry)["Service"]["getById"] = Effect.fn(
    "SshConnectionRegistry.getById",
  )(function* (connectionId) {
    const connections = yield* readConnectionsFile;
    const match = connections.find((connection) => connection.id === connectionId);
    if (match === undefined) {
      return yield* new SshConnectionNotFoundError({ connectionId });
    }
    return match;
  });

  const list: (typeof SshConnectionRegistry)["Service"]["list"] = () => readConnectionsFile;

  const upsert: (typeof SshConnectionRegistry)["Service"]["upsert"] = Effect.fn(
    "SshConnectionRegistry.upsert",
  )(function* (input) {
    const connections = [...(yield* readConnectionsFile)];
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const port = input.port ?? 22;
    const existingIndex = connections.findIndex((connection) => connection.id === id);
    const existing = existingIndex >= 0 ? connections[existingIndex] : undefined;

    const nextConnection: SshConnectionConfig = {
      id,
      host: input.host,
      port,
      username: input.username,
      authType: input.authType,
      ...(input.privateKeyPath === undefined ? {} : { privateKeyPath: input.privateKeyPath }),
      label: input.label,
      status: existing?.status ?? "disconnected",
      ...(existing?.lastConnectedAt === undefined
        ? {}
        : { lastConnectedAt: existing.lastConnectedAt }),
      ...(existing?.lastError === undefined ? {} : { lastError: existing.lastError }),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const nextConnections =
      existingIndex >= 0
        ? connections.map((connection, index) =>
            index === existingIndex ? nextConnection : connection,
          )
        : [...connections, nextConnection];

    yield* writeConnectionsFile(nextConnections);
    return toConnectionSummary(nextConnection);
  });

  const deleteConnection: (typeof SshConnectionRegistry)["Service"]["delete"] = Effect.fn(
    "SshConnectionRegistry.delete",
  )(function* (connectionId) {
    const connections = [...(yield* readConnectionsFile)];
    const nextConnections = connections.filter((connection) => connection.id !== connectionId);
    if (nextConnections.length === connections.length) {
      return yield* new SshConnectionNotFoundError({ connectionId });
    }
    yield* writeConnectionsFile(nextConnections);
  });

  const recordConnectionResult: (typeof SshConnectionRegistry)["Service"]["recordConnectionResult"] =
    Effect.fn("SshConnectionRegistry.recordConnectionResult")(function* (input) {
      const connections = [...(yield* readConnectionsFile)];
      const index = connections.findIndex((connection) => connection.id === input.connectionId);
      if (index < 0) {
        return yield* new SshConnectionNotFoundError({ connectionId: input.connectionId });
      }

      const existing = connections[index]!;
      const now = new Date().toISOString();
      const nextConnection: SshConnectionConfig = input.ok
        ? {
            id: existing.id,
            host: existing.host,
            port: existing.port,
            username: existing.username,
            authType: existing.authType,
            ...(existing.privateKeyPath === undefined
              ? {}
              : { privateKeyPath: existing.privateKeyPath }),
            label: existing.label,
            status: "connected",
            lastConnectedAt: now,
            createdAt: existing.createdAt,
            updatedAt: now,
          }
        : {
            ...existing,
            status: "error",
            updatedAt: now,
            lastError: input.error ?? "Connection failed",
          };
      const nextConnections = connections.map((connection, connectionIndex) =>
        connectionIndex === index ? nextConnection : connection,
      );
      yield* writeConnectionsFile(nextConnections);
    });

  return {
    getById,
    list,
    upsert,
    delete: deleteConnection,
    recordConnectionResult,
  } satisfies (typeof SshConnectionRegistry)["Service"];
});

export const SshConnectionRegistryLive = Layer.effect(
  SshConnectionRegistry,
  makeSshConnectionRegistry,
);

export const makeSshConnectionRegistryTestLayer = (
  connections: ReadonlyArray<SshConnectionConfig>,
) =>
  Layer.succeed(SshConnectionRegistry, {
    getById: (connectionId) => {
      const match = connections.find((connection) => connection.id === connectionId);
      return match === undefined
        ? Effect.fail(new SshConnectionNotFoundError({ connectionId }))
        : Effect.succeed(match);
    },
    list: () => Effect.succeed(connections),
    upsert: (input) => {
      const now = new Date().toISOString();
      const id = input.id ?? "test-connection";
      const summary: SshConnectionSummary = {
        id,
        host: input.host,
        port: input.port ?? 22,
        username: input.username,
        authType: input.authType,
        ...(input.privateKeyPath === undefined ? {} : { privateKeyPath: input.privateKeyPath }),
        label: input.label,
        status: "disconnected",
      };
      return Effect.succeed(summary);
    },
    delete: (connectionId) =>
      connections.some((connection) => connection.id === connectionId)
        ? Effect.void
        : Effect.fail(new SshConnectionNotFoundError({ connectionId })),
    recordConnectionResult: () => Effect.void,
  });
