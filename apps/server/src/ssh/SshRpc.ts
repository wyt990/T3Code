import type {
  ServerGetConnectionProvidersInput,
  SshConfirmHostKeyInput,
  SshConnectionConfig,
  SshConnectionSummary,
  SshDeleteConnectionInput,
  SshListProviderProbesInput,
  SshListProviderProbesResult,
  SshProviderProbeEntry,
  SshTestConnectionInput,
  SshTestConnectionResult,
  SshUpsertConnectionInput,
} from "@t3tools/contracts";
import { SshListDirectoryError } from "@t3tools/contracts";
import { Cause, Effect } from "effect";
import type { ConnectConfig } from "ssh2";

import { RemoteProviderProbe } from "../provider/remoteProviderProbe.ts";
import { getConnectionProvidersForSshProject } from "./connectionProviders.ts";
import { buildSshConnectConfig } from "./buildSshConnectConfig.ts";
import { formatSshUserMessage } from "./formatSshUserMessage.ts";
import { SshError } from "./Errors.ts";
import { SshConnectionRegistry } from "./Services/SshConnectionRegistry.ts";
import { SshCredentialResolver } from "./Services/SshCredentialResolver.ts";
import { SshFileSystem } from "./Services/SshFileSystem.ts";
import { SshHostKeyVerifier } from "./Services/SshHostKeyVerifier.ts";
import {
  connectSsh2Client,
  createSsh2Client,
  endSsh2Client,
  sshHostKeyFingerprintSha256,
} from "./ssh2Adapter.ts";

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

const normalizeRemoteBrowsePath = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "/";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

export const listSshConnections = Effect.gen(function* () {
  const registry = yield* SshConnectionRegistry;
  const connections = yield* registry.list();
  return connections.map(toConnectionSummary);
});

export const upsertSshConnection = (input: SshUpsertConnectionInput) =>
  Effect.gen(function* () {
    const registry = yield* SshConnectionRegistry;
    return yield* registry.upsert(input);
  });

export const deleteSshConnection = (input: SshDeleteConnectionInput) =>
  Effect.gen(function* () {
    const registry = yield* SshConnectionRegistry;
    const remoteProviderProbe = yield* RemoteProviderProbe;
    yield* registry
      .delete(input.id)
      .pipe(Effect.catchTag("SshConnectionNotFoundError", () => Effect.void));
    remoteProviderProbe.invalidate(input.id);
  });

export const confirmSshHostKey = (input: SshConfirmHostKeyInput) =>
  Effect.gen(function* () {
    const hostKeys = yield* SshHostKeyVerifier;
    yield* hostKeys.recordTrustedHost(input);
  });

const runTestSshConnection = (input: SshTestConnectionInput) =>
  Effect.gen(function* () {
    const registry = yield* SshConnectionRegistry;
    const credentials = yield* SshCredentialResolver;
    const hostKeys = yield* SshHostKeyVerifier;

    const connection = yield* registry.getById(input.connectionId);
    const auth = yield* credentials.resolve(input.connectionId).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("SSH 凭证解析失败", {
          connectionId: input.connectionId,
          error: error.detail,
        }),
      ),
    );

    let observedFingerprint: string | undefined;
    const hostVerifier: NonNullable<ConnectConfig["hostVerifier"]> = (hostKey: Buffer) => {
      observedFingerprint = sshHostKeyFingerprintSha256(hostKey);
      const expected = hostKeys.fingerprintForHost({
        host: connection.host,
        port: connection.port,
      });
      if (expected === undefined) {
        return false;
      }
      return expected === observedFingerprint;
    };

    const connectConfig = yield* buildSshConnectConfig({
      connection,
      auth,
      hostVerifier,
    });

    const client = createSsh2Client();
    let connectError: unknown = undefined;
    const connectSucceeded = yield* Effect.tryPromise({
      try: async () => {
        try {
          await connectSsh2Client(client, { config: connectConfig });
          return true as const;
        } catch (error) {
          connectError = error;
          return false as const;
        }
      },
      catch: (error) => new Error(String(error)),
    });
    if (!connectSucceeded && connectError !== undefined) {
      yield* Effect.logWarning("SSH 连接失败", {
        connectionId: input.connectionId,
        error: connectError instanceof Error ? connectError.message : String(connectError),
        ...(connectError instanceof Error && (connectError as { code?: string }).code !== undefined
          ? { code: (connectError as unknown as { code: string }).code }
          : {}),
      });
    }

    yield* Effect.tryPromise({
      try: () => endSsh2Client(client),
      catch: () => undefined,
    }).pipe(Effect.ignore);

    if (connectSucceeded) {
      yield* registry.recordConnectionResult({
        connectionId: input.connectionId,
        ok: true,
      });
      const remoteProviderProbe = yield* RemoteProviderProbe;
      yield* remoteProviderProbe.probeConnection(input.connectionId).pipe(Effect.ignore);
      return {
        ok: true,
      } satisfies SshTestConnectionResult;
    }

    const expectedFingerprint = hostKeys.fingerprintForHost({
      host: connection.host,
      port: connection.port,
    });
    if (observedFingerprint !== undefined && expectedFingerprint === undefined) {
      return {
        ok: false,
        hostKey: {
          host: connection.host,
          port: connection.port,
          fingerprint: observedFingerprint,
        },
      } satisfies SshTestConnectionResult;
    }

    yield* Effect.logWarning("SSH 连接失败（无详细错误信息）", {
      connectionId: input.connectionId,
      host: connection.host,
      port: connection.port,
      authType: connection.authType,
    });
    const detail = formatSshUserMessage(new Error("SSH connect failed"));
    yield* registry.recordConnectionResult({
      connectionId: input.connectionId,
      ok: false,
      error: detail,
    });
    return {
      ok: false,
      error: detail,
    } satisfies SshTestConnectionResult;
  });

export const testSshConnection = (input: SshTestConnectionInput) =>
  runTestSshConnection(input).pipe(
    Effect.tapError((error) =>
      Effect.logWarning("SSH 测试连接失败（catch 捕获）", {
        connectionId: input.connectionId,
        errorType:
          error !== null && error !== undefined
            ? (error.constructor?.name ?? typeof error)
            : "null/undefined",
        error:
          error instanceof Error
            ? `${error.message} (code=${(error as { code?: string }).code ?? "none"})`
            : String(error),
        errorProps: error instanceof Error ? undefined : JSON.stringify(error),
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const failReason = cause.reasons.find(Cause.isFailReason);
        yield* Effect.logWarning("SSH 测试连接全部失败原因", {
          connectionId: input.connectionId,
          cause: Cause.pretty(cause),
        });
        return {
          ok: false,
          error: formatSshUserMessage(failReason?.error ?? "Unknown SSH connection error"),
        } satisfies SshTestConnectionResult;
      }),
    ),
  );

export const listSshProviderProbes = (input: SshListProviderProbesInput) =>
  Effect.gen(function* () {
    const remoteProviderProbe = yield* RemoteProviderProbe;
    const cached = remoteProviderProbe.getProbes(input.connectionId);
    const probes = cached ?? (yield* remoteProviderProbe.probeConnection(input.connectionId));

    const entries: Array<SshProviderProbeEntry> = [...probes.entries()].map(
      ([provider, probe]) => ({
        provider,
        available: probe.available,
        ...(probe.binaryPath === null ? {} : { binaryPath: probe.binaryPath }),
        ...(probe.version === null ? {} : { version: probe.version }),
        ...(probe.error === null ? {} : { error: probe.error }),
        probedAt: probe.probedAt,
      }),
    );

    return {
      connectionId: input.connectionId,
      probes: entries,
    } satisfies SshListProviderProbesResult;
  });

/** Remote SSH project provider list (claudeAgent + opencode only). */
export const getConnectionProviders = (input: ServerGetConnectionProvidersInput) =>
  getConnectionProvidersForSshProject({
    connectionId: input.connectionId,
    projectId: input.projectId,
    ...(input.invalidate === true ? { invalidate: true } : {}),
  });

export const listSshDirectory = (input: { readonly connectionId: string; readonly path: string }) =>
  Effect.gen(function* () {
    const remoteFileSystem = yield* SshFileSystem;
    const parentPath = normalizeRemoteBrowsePath(input.path);
    const entries = yield* remoteFileSystem
      .list({ connectionId: input.connectionId, path: parentPath, lane: "browse" })
      .pipe(
        Effect.mapError((error) =>
          toListDirectoryError({
            connectionId: input.connectionId,
            path: parentPath,
            error,
          }),
        ),
      );

    return {
      parentPath,
      entries: [...entries]
        .toSorted((left, right) => {
          if (left.type === "directory" && right.type !== "directory") {
            return -1;
          }
          if (right.type === "directory" && left.type !== "directory") {
            return 1;
          }
          return left.name.localeCompare(right.name);
        })
        .map((entry) => ({
          name: entry.name,
          fullPath: entry.path,
          type: entry.type,
        })),
    };
  });

const toListDirectoryError = (input: {
  readonly connectionId: string;
  readonly path: string;
  readonly error: SshError;
}): SshListDirectoryError =>
  new SshListDirectoryError({
    connectionId: input.connectionId,
    path: input.path,
    detail: input.error.message,
    cause: input.error,
  });
