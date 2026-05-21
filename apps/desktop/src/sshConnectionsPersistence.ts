import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

import type {
  SshConnectionConfig,
  SshConnectionSummary,
  SshUpsertConnectionInput,
} from "@t3tools/contracts";
import { Predicate } from "effect";

interface SshConnectionsDocument {
  readonly connections: readonly SshConnectionConfig[];
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!FS.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(FS.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  const directory = Path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, filePath);
}

function isSshConnectionConfig(value: unknown): value is SshConnectionConfig {
  return (
    Predicate.isObject(value) &&
    typeof value.id === "string" &&
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    typeof value.username === "string" &&
    typeof value.authType === "string" &&
    typeof value.label === "string" &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function readConnectionsDocument(filePath: string): SshConnectionsDocument {
  const parsed = readJsonFile<SshConnectionsDocument>(filePath);
  if (!Predicate.isObject(parsed)) {
    return { connections: [] };
  }

  return {
    connections: Array.isArray(parsed.connections)
      ? parsed.connections.filter(isSshConnectionConfig)
      : [],
  };
}

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

export function listSshConnections(filePath: string): ReadonlyArray<SshConnectionSummary> {
  return readConnectionsDocument(filePath).connections.map(toConnectionSummary);
}

export function upsertSshConnection(
  filePath: string,
  input: SshUpsertConnectionInput,
): SshConnectionSummary {
  const document = readConnectionsDocument(filePath);
  const now = new Date().toISOString();
  const id = input.id ?? Crypto.randomUUID();
  const port = input.port ?? 22;
  const existingIndex = document.connections.findIndex((connection) => connection.id === id);
  const existing = existingIndex >= 0 ? document.connections[existingIndex] : undefined;

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
      ? document.connections.map((connection, index) =>
          index === existingIndex ? nextConnection : connection,
        )
      : [...document.connections, nextConnection];

  writeJsonFile(filePath, { connections: nextConnections });
  return toConnectionSummary(nextConnection);
}

export function deleteSshConnection(filePath: string, connectionId: string): void {
  const document = readConnectionsDocument(filePath);
  writeJsonFile(filePath, {
    connections: document.connections.filter((connection) => connection.id !== connectionId),
  });
}
