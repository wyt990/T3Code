import type { ProviderKind, ServerProviderModel } from "@t3tools/contracts";
import { Context, DateTime, Effect, Layer, Option, Result } from "effect";

import { SshProcessRunner, type SshProcessRunnerShape } from "../ssh/Services/SshProcessRunner.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ClaudeCliModelListJsonSchema, resolveClaudeModelsFromCliJson } from "./claudeModelList.ts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import {
  clearRemoteClaudeBinaryCacheForConnection,
  clearRemoteCodexBinaryCacheForConnection,
  clearRemoteCursorBinaryCacheForConnection,
  clearRemoteOpenCodeBinaryCacheForConnection,
  remoteClaudeCommandName,
  remoteOpenCodeCommandName,
} from "./remoteProviderBinary.ts";
import { shellQuotePosix } from "../ssh/ssh2Adapter.ts";

const remoteWhichProbeCommand = (commandName: string): string =>
  `command -v ${shellQuotePosix(commandName)} 2>/dev/null || which ${shellQuotePosix(commandName)} 2>/dev/null || type -p ${shellQuotePosix(commandName)} 2>/dev/null`;

export interface RemoteProviderProbeResult {
  readonly available: boolean;
  readonly binaryPath: string | null;
  readonly version: string | null;
  readonly probedAt: string;
  readonly error: string | null;
}

/** Neutral cwd for remote CLI probes (SSH user home). Avoids project source trees; works without /tmp. */
export const REMOTE_MODEL_PROBE_CWD = "~";
const PROBE_CWD = REMOTE_MODEL_PROBE_CWD;

const probeCache = new Map<string, Map<ProviderKind, RemoteProviderProbeResult>>();

type ConnectionModelCache = {
  claudeAgent?: ReadonlyArray<ServerProviderModel>;
  opencodeByWorkspace?: Map<string, ReadonlyArray<ServerProviderModel>>;
};

const modelCache = new Map<string, ConnectionModelCache>();

const normalizeWorkspaceCacheKey = (workspaceRoot: string): string => workspaceRoot.trim() || "/";

const getConnectionModelCache = (connectionId: string): ConnectionModelCache => {
  const existing = modelCache.get(connectionId);
  if (existing) {
    return existing;
  }
  const created: ConnectionModelCache = {};
  modelCache.set(connectionId, created);
  return created;
};

const parseFirstLine = (stdout: string): string | undefined =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

const runRemoteCommand = (
  exec: (input: {
    readonly connectionId: string;
    readonly command: string;
    readonly cwd?: string;
  }) => Effect.Effect<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>,
  connectionId: string,
  command: string,
) =>
  Effect.gen(function* () {
    // SshProcessRunner.exec 已经用 bash -ilc 包裹命令并 source .bashrc/.profile，
    // 这里直接传递原始命令，避免双重 bash 嵌套导致环境变量（PATH 等）加载异常
    yield* Effect.logDebug("[RemoteProviderProbe] Executing SSH command", {
      connectionId,
      fullCommand: command,
    });
    const result = yield* exec({
      connectionId,
      command,
      cwd: PROBE_CWD,
    });
    yield* Effect.logDebug("[RemoteProviderProbe] SSH command result", {
      connectionId,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
    return result;
  });

const probeProviderBinary = Effect.fn("probeProviderBinary")(function* (input: {
  readonly connectionId: string;
  readonly commandName: string;
  readonly versionArgs: ReadonlyArray<string>;
  readonly exec: (input: {
    readonly connectionId: string;
    readonly command: string;
  }) => Effect.Effect<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}) {
  const probedAt = DateTime.formatIso(yield* DateTime.now);

  yield* Effect.logInfo("[RemoteProviderProbe] Probing binary", {
    connectionId: input.connectionId,
    commandName: input.commandName,
    versionArgs: input.versionArgs,
  });

  const whichCommand = remoteWhichProbeCommand(input.commandName);

  yield* Effect.logDebug("[RemoteProviderProbe] executing which command", {
    connectionId: input.connectionId,
    commandName: input.commandName,
    fullCommand: whichCommand,
  });

  const whichResult = yield* runRemoteCommand(input.exec, input.connectionId, whichCommand);

  yield* Effect.logDebug("[RemoteProviderProbe] which command result", {
    connectionId: input.connectionId,
    exitCode: whichResult.exitCode,
    stdoutLength: whichResult.stdout.length,
    stderrLength: whichResult.stderr.length,
  });

  const binaryPath = parseFirstLine(whichResult.stdout);
  if (whichResult.exitCode !== 0 || binaryPath === undefined) {
    yield* Effect.logInfo("[RemoteProviderProbe] Binary not found", {
      connectionId: input.connectionId,
      commandName: input.commandName,
      exitCode: whichResult.exitCode,
      stdout: whichResult.stdout,
      stderr: whichResult.stderr,
    });
    return {
      available: false,
      binaryPath: null,
      version: null,
      probedAt,
      error:
        whichResult.stderr.trim().length > 0
          ? whichResult.stderr.trim()
          : `Remote binary '${input.commandName}' was not found.`,
    } satisfies RemoteProviderProbeResult;
  }

  yield* Effect.logInfo("[RemoteProviderProbe] Binary found, probing version", {
    connectionId: input.connectionId,
    commandName: input.commandName,
    binaryPath,
  });

  if (input.versionArgs.length === 0) {
    return {
      available: true,
      binaryPath,
      version: null,
      probedAt,
      error: null,
    } satisfies RemoteProviderProbeResult;
  }

  // 逐个尝试版本参数，直到成功
  let version: string | null = null;
  let versionError: string | null = null;
  for (const versionArg of input.versionArgs) {
    const versionCommand = `${shellQuotePosix(binaryPath)} ${versionArg}`;

    yield* Effect.logDebug("[RemoteProviderProbe] executing version command", {
      connectionId: input.connectionId,
      commandName: input.commandName,
      binaryPath,
      versionArg,
      fullCommand: versionCommand,
    });

    const versionResult = yield* runRemoteCommand(input.exec, input.connectionId, versionCommand);

    yield* Effect.logDebug("[RemoteProviderProbe] version command result", {
      connectionId: input.connectionId,
      exitCode: versionResult.exitCode,
      stdoutLength: versionResult.stdout.length,
      stderrLength: versionResult.stderr.length,
    });
    if (versionResult.exitCode === 0) {
      version = parseFirstLine(versionResult.stdout) ?? null;
      yield* Effect.logInfo("[RemoteProviderProbe] Version detected", {
        connectionId: input.connectionId,
        commandName: input.commandName,
        binaryPath,
        versionArg,
        version,
      });
      break;
    }
    if (versionResult.stderr.trim().length > 0) {
      versionError = versionResult.stderr.trim();
    }
  }

  return {
    available: true,
    binaryPath,
    version,
    probedAt,
    error: versionError,
  } satisfies RemoteProviderProbeResult;
});

export interface RemoteProviderProbeShape {
  readonly probeConnection: (
    connectionId: string,
  ) => Effect.Effect<ReadonlyMap<ProviderKind, RemoteProviderProbeResult>>;
  readonly getProbes: (
    connectionId: string,
  ) => ReadonlyMap<ProviderKind, RemoteProviderProbeResult> | undefined;
  readonly getClaudeModels: (
    connectionId: string,
  ) => ReadonlyArray<ServerProviderModel> | undefined;
  readonly getOpenCodeModels: (
    connectionId: string,
    workspaceRoot: string,
  ) => ReadonlyArray<ServerProviderModel> | undefined;
  readonly cacheOpenCodeModels: (
    connectionId: string,
    workspaceRoot: string,
    models: ReadonlyArray<ServerProviderModel>,
  ) => void;
  readonly invalidate: (connectionId: string, options?: { readonly clearModels?: boolean }) => void;
}

export class RemoteProviderProbe extends Context.Service<
  RemoteProviderProbe,
  RemoteProviderProbeShape
>()("t3/provider/RemoteProviderProbe") {}

const invalidateRemoteProviderProbeCaches = (
  connectionId: string,
  options?: { readonly clearModels?: boolean },
): void => {
  probeCache.delete(connectionId);
  if (options?.clearModels === true) {
    modelCache.delete(connectionId);
  }
  clearRemoteCodexBinaryCacheForConnection(connectionId);
  clearRemoteClaudeBinaryCacheForConnection(connectionId);
  clearRemoteCursorBinaryCacheForConnection(connectionId);
  clearRemoteOpenCodeBinaryCacheForConnection(connectionId);
};

export const makeRemoteProviderProbe = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;

  const exec = (input: {
    readonly connectionId: string;
    readonly command: string;
    readonly cwd?: string;
  }): Effect.Effect<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> =>
    Effect.gen(function* () {
      const sshProcessRunner = yield* SshProcessRunner;
      return yield* sshProcessRunner.exec({ ...input, lane: "probe" });
    }).pipe(
      Effect.map((result) => ({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      })),
      Effect.catch(() =>
        Effect.succeed({
          stdout: "",
          stderr: "",
          exitCode: 1,
        }),
      ),
    );

  const probeConnection: RemoteProviderProbeShape["probeConnection"] = (connectionId) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const claudeCommandName = remoteClaudeCommandName(settings.providers.claudeAgent.binaryPath);

      // ClaudeAgent 检测：尝试 claude 和 claudecode 两个命令
      // 优先使用配置的命令名，失败后尝试另一个
      const claudeAgentProbe = Effect.gen(function* () {
        const firstProbe = yield* probeProviderBinary({
          connectionId,
          commandName: claudeCommandName,
          versionArgs: ["-v", "--version"],
          exec,
        });
        if (firstProbe.available) {
          return firstProbe;
        }
        // 如果配置的是 claudecode，第二个尝试 claude；反之亦然
        const secondCommandName = claudeCommandName === "claudecode" ? "claude" : "claudecode";
        const secondProbe = yield* probeProviderBinary({
          connectionId,
          commandName: secondCommandName,
          versionArgs: ["-v", "--version"],
          exec,
        });
        if (secondProbe.available) {
          return secondProbe;
        }
        // 两个都失败，返回第一个的错误信息（包含尝试过的命令）
        return {
          ...firstProbe,
          error: `Remote binary '${claudeCommandName}' and '${secondCommandName}' were not found.`,
        } satisfies RemoteProviderProbeResult;
      });

      // 顺序探测：只探测 claudeAgent 和 opencode
      // 使用 Effect.all 统一 Effect 上下文，{ concurrency: 1 } 确保顺序执行
      const probes = yield* Effect.all(
        [
          claudeAgentProbe.pipe(Effect.map((result) => ["claudeAgent", result] as const)),
          probeProviderBinary({
            connectionId,
            commandName: remoteOpenCodeCommandName(settings.providers.opencode.binaryPath),
            versionArgs: ["--version"],
            exec,
          }).pipe(Effect.map((result) => ["opencode", result] as const)),
        ],
        { concurrency: 1 },
      );

      const byProvider = new Map<ProviderKind, RemoteProviderProbeResult>(probes);
      probeCache.set(connectionId, byProvider);

      return byProvider;
    }).pipe(
      Effect.withSpan("RemoteProviderProbe.probeConnection"),
      Effect.catch(() => Effect.succeed(new Map<ProviderKind, RemoteProviderProbeResult>())),
    );

  return {
    probeConnection,
    getProbes: (connectionId) => probeCache.get(connectionId),
    getClaudeModels: (connectionId) => getConnectionModelCache(connectionId).claudeAgent,
    getOpenCodeModels: (connectionId, workspaceRoot) =>
      getConnectionModelCache(connectionId).opencodeByWorkspace?.get(
        normalizeWorkspaceCacheKey(workspaceRoot),
      ),
    cacheOpenCodeModels: (connectionId, workspaceRoot, models) => {
      const cache = getConnectionModelCache(connectionId);
      const byWorkspace = cache.opencodeByWorkspace ?? new Map();
      byWorkspace.set(normalizeWorkspaceCacheKey(workspaceRoot), models);
      cache.opencodeByWorkspace = byWorkspace;
    },
    invalidate: invalidateRemoteProviderProbeCaches,
  } satisfies RemoteProviderProbeShape;
});

export const RemoteProviderProbeLive = Layer.effect(RemoteProviderProbe, makeRemoteProviderProbe);

export const makeRemoteProviderProbeTestLayer = (options: {
  readonly probeConnection: RemoteProviderProbeShape["probeConnection"];
  readonly getProbes?: RemoteProviderProbeShape["getProbes"];
  readonly getClaudeModels?: RemoteProviderProbeShape["getClaudeModels"];
  readonly getOpenCodeModels?: RemoteProviderProbeShape["getOpenCodeModels"];
  readonly cacheOpenCodeModels?: RemoteProviderProbeShape["cacheOpenCodeModels"];
  readonly invalidate?: RemoteProviderProbeShape["invalidate"];
}) =>
  Layer.succeed(RemoteProviderProbe, {
    probeConnection: options.probeConnection,
    getProbes: options.getProbes ?? (() => undefined),
    getClaudeModels: options.getClaudeModels ?? (() => undefined),
    getOpenCodeModels: options.getOpenCodeModels ?? (() => undefined),
    cacheOpenCodeModels: options.cacheOpenCodeModels ?? (() => undefined),
    invalidate: options.invalidate ?? (() => undefined),
  });

const MODEL_PROBE_TIMEOUT_MS = 30_000;

/**
 * Probe Claude models on a remote SSH server (`claudecode --list-models --json`).
 */
const probeRemoteClaudeModelsImpl = (
  sshProcessRunner: SshProcessRunnerShape,
  connectionId: string,
  binaryPath: string,
  version: string | null,
) =>
  Effect.gen(function* () {
    const command = `${shellQuotePosix(binaryPath)} --list-models --json`;

    const result = yield* sshProcessRunner
      .exec({
        connectionId,
        command,
        cwd: PROBE_CWD,
        lane: "probe",
      })
      .pipe(Effect.timeout(MODEL_PROBE_TIMEOUT_MS));

    if (result.exitCode !== 0) {
      const stderr = result.stderr?.trim() ?? "";
      yield* Effect.logWarning("[RemoteProviderProbe] claudecode --list-models failed", {
        connectionId,
        binaryPath,
        cwd: PROBE_CWD,
        exitCode: result.exitCode,
        stderr: stderr.length > 0 ? stderr : undefined,
      });
      return yield* Effect.fail(
        new Error(
          stderr.length > 0
            ? `远程 claudecode --list-models 退出码 ${result.exitCode}：${stderr}`
            : `远程 claudecode --list-models 退出码 ${result.exitCode}。`,
        ),
      );
    }

    const trimmed = (result.stdout ?? "").trim();
    if (!trimmed) {
      yield* Effect.logWarning(
        "[RemoteProviderProbe] claudecode --list-models returned no stdout",
        {
          connectionId,
          binaryPath,
          cwd: PROBE_CWD,
        },
      );
      return yield* Effect.fail(new Error("远程 claudecode --list-models 未返回 JSON。"));
    }

    const decoded = decodeJsonResult(ClaudeCliModelListJsonSchema)(trimmed);
    if (Result.isFailure(decoded)) {
      yield* Effect.logWarning("[RemoteProviderProbe] claudecode --list-models JSON parse failed", {
        connectionId,
        binaryPath,
        cwd: PROBE_CWD,
      });
      return yield* Effect.fail(new Error("远程 claudecode --list-models JSON 解析失败。"));
    }

    const models = resolveClaudeModelsFromCliJson(decoded.success, version);
    if (models.length === 0) {
      yield* Effect.logWarning("[RemoteProviderProbe] No remote Claude models in JSON", {
        connectionId,
        binaryPath,
        cwd: PROBE_CWD,
      });
      return yield* Effect.fail(new Error("远程 claudecode --list-models 未包含可用模型。"));
    }

    return models;
  });

/** Load remote `claudecode --list-models` into the per-connection cache (neutral cwd, probe lane). */
export const refreshRemoteClaudeModelsForConnection = Effect.fn(
  "refreshRemoteClaudeModelsForConnection",
)(function* (input: {
  readonly connectionId: string;
  readonly binaryPath: string;
  readonly version: string | null;
}) {
  const sshProcessRunner = yield* SshProcessRunner;
  const cache = getConnectionModelCache(input.connectionId);
  const models = yield* probeRemoteClaudeModelsImpl(
    sshProcessRunner,
    input.connectionId,
    input.binaryPath,
    input.version,
  ).pipe(Effect.option);

  if (Option.isSome(models)) {
    cache.claudeAgent = models.value;
    return models.value;
  }

  return cache.claudeAgent ?? [];
});
