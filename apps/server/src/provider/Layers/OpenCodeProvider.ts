import type { OpenCodeSettings, ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import { Cause, Data, Effect, Equal, Layer, Stream } from "effect";

import {
  DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  flattenOpenCodeModels,
} from "../openCodeModelList.ts";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  buildServerProvider,
  nonEmptyTrimmed,
  parseGenericCliVersion,
  providerModelsFromSettings,
} from "../providerSnapshot.ts";
import { compareCliVersions } from "../cliVersion.ts";
import { OpenCodeProvider } from "../Services/OpenCodeProvider.ts";
import {
  OpenCodeRuntime,
  openCodeRuntimeErrorDetail,
  type OpenCodeInventory,
} from "../opencodeRuntime.ts";

const PROVIDER = "opencode" as const;
const OPENCODE_PRESENTATION = {
  displayName: "OpenCode",
  showInteractionModeToggle: false,
} as const;
const MINIMUM_OPENCODE_VERSION = "1.14.19";

class OpenCodeProbeError extends Data.TaggedError("OpenCodeProbeError")<{
  readonly cause: unknown;
  readonly detail: string;
}> {}

function normalizeProbeMessage(message: string): string | undefined {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (
    trimmed === "An error occurred in Effect.tryPromise" ||
    trimmed === "An error occurred in Effect.try"
  ) {
    return undefined;
  }
  return trimmed;
}

function normalizedErrorMessage(cause: unknown): string | undefined {
  if (cause instanceof OpenCodeProbeError) {
    return normalizeProbeMessage(cause.detail);
  }

  if (!(cause instanceof Error)) {
    return undefined;
  }

  return normalizeProbeMessage(cause.message);
}

function formatOpenCodeProbeError(input: {
  readonly cause: unknown;
  readonly isExternalServer: boolean;
  readonly serverUrl: string;
}): { readonly installed: boolean; readonly message: string } {
  const detail = normalizedErrorMessage(input.cause);
  const lower = detail?.toLowerCase() ?? "";

  if (input.isExternalServer) {
    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden")
    ) {
      return {
        installed: true,
        message: "OpenCode 服务器拒绝了认证。检查服务器 URL 和密码。",
      };
    }

    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("fetch failed") ||
      lower.includes("networkerror") ||
      lower.includes("timed out") ||
      lower.includes("timeout") ||
      lower.includes("socket hang up")
    ) {
      return {
        installed: true,
        message: `无法连接到配置的 OpenCode 服务器 at ${input.serverUrl}. 检查服务器是否运行且 URL 正确。`,
      };
    }

    return {
      installed: true,
      message: detail ?? "连接到配置的 OpenCode 服务器失败。",
    };
  }

  if (lower.includes("enoent") || lower.includes("notfound")) {
    return {
      installed: false,
      message: "OpenCode CLI (`opencode`) 未安装或未在 PATH 中。",
    };
  }

  if (lower.includes("quarantine")) {
    return {
      installed: true,
      message:
        "macOS 阻止 OpenCode 二进制文件 ( quarantine ). 运行 `xattr -d com.apple.quarantine $(which opencode)` 修复此问题。",
    };
  }

  if (lower.includes("invalid code signature") || lower.includes("corrupted")) {
    return {
      installed: true,
      message:
        "macOS 因无效代码签名杀死了 OpenCode 进程。二进制文件可能已损坏 — 尝试重新安装 OpenCode。",
    };
  }

  return {
    installed: true,
    message: detail
      ? `执行 OpenCode CLI 健康检查失败: ${detail}`
      : "执行 OpenCode CLI 健康检查失败。",
  };
}

const makePendingOpenCodeProvider = (openCodeSettings: OpenCodeSettings): ServerProvider => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    [],
    PROVIDER,
    openCodeSettings.customModels,
    DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  );

  if (!openCodeSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: OPENCODE_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message:
          openCodeSettings.serverUrl.trim().length > 0
            ? "OpenCode 在设置中已禁用。已配置服务器 URL。"
            : "OpenCode 在设置中已禁用。",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    presentation: OPENCODE_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "本次会话尚未检查 OpenCode 服务提供商状态。",
    },
  });
};

export const OpenCodeProviderLive = Layer.effect(
  OpenCodeProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const serverConfig = yield* ServerConfig;
    const openCodeRuntime = yield* OpenCodeRuntime;

    const checkOpenCodeProviderStatus = Effect.fn("checkOpenCodeProviderStatus")(function* (input: {
      readonly settings: OpenCodeSettings;
      readonly cwd: string;
    }): Effect.fn.Return<ServerProvider, never> {
      const checkedAt = new Date().toISOString();
      const customModels = input.settings.customModels;
      const isExternalServer = input.settings.serverUrl.trim().length > 0;

      const fallback = (cause: unknown, version: string | null = null) => {
        const failure = formatOpenCodeProbeError({
          cause,
          isExternalServer,
          serverUrl: input.settings.serverUrl,
        });
        const installed = version !== null ? true : failure.installed;
        const runtimeDetail = normalizedErrorMessage(cause);
        const baseMessage =
          version !== null && !isExternalServer && failure.installed === false
            ? "OpenCode CLI 版本检查已通过，但启动或连接 OpenCode 服务失败。请检查 `opencode serve` 是否可在当前环境正常运行。"
            : failure.message;
        const message =
          runtimeDetail && !baseMessage.includes(runtimeDetail)
            ? `${baseMessage} 细节: ${runtimeDetail}`
            : baseMessage;
        return buildServerProvider({
          provider: PROVIDER,
          presentation: OPENCODE_PRESENTATION,
          enabled: input.settings.enabled,
          checkedAt,
          models: providerModelsFromSettings(
            [],
            PROVIDER,
            customModels,
            DEFAULT_OPENCODE_MODEL_CAPABILITIES,
          ),
          probe: {
            installed,
            version,
            status: "error",
            auth: { status: "unknown" },
            message,
          },
        });
      };

      if (!input.settings.enabled) {
        return buildServerProvider({
          provider: PROVIDER,
          presentation: OPENCODE_PRESENTATION,
          enabled: false,
          checkedAt,
          models: providerModelsFromSettings(
            [],
            PROVIDER,
            customModels,
            DEFAULT_OPENCODE_MODEL_CAPABILITIES,
          ),
          probe: {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: isExternalServer
              ? "OpenCode 在设置中已禁用。已配置服务器 URL。"
              : "OpenCode 在设置中已禁用。",
          },
        });
      }

      let version: string | null = null;
      if (!isExternalServer) {
        const versionExit = yield* Effect.exit(
          openCodeRuntime
            .runOpenCodeCommand({
              binaryPath: input.settings.binaryPath,
              args: ["--version"],
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
              ),
            ),
        );
        if (versionExit._tag === "Failure") {
          return fallback(Cause.squash(versionExit.cause));
        }
        version = parseGenericCliVersion(versionExit.value.stdout) ?? null;

        if (!version) {
          return fallback(
            new Error(
              `无法确定 OpenCode 版本从 \`opencode --version\` 输出。T3 Code 需要 OpenCode v${MINIMUM_OPENCODE_VERSION} 或更新的版本。`,
            ),
            null,
          );
        }
        if (compareCliVersions(version, MINIMUM_OPENCODE_VERSION) < 0) {
          return buildServerProvider({
            provider: PROVIDER,
            presentation: OPENCODE_PRESENTATION,
            enabled: input.settings.enabled,
            checkedAt,
            models: providerModelsFromSettings(
              [],
              PROVIDER,
              customModels,
              DEFAULT_OPENCODE_MODEL_CAPABILITIES,
            ),
            probe: {
              installed: true,
              version,
              status: "error",
              auth: { status: "unknown" },
              message: `OpenCode v${version} 太旧。升级到 v${MINIMUM_OPENCODE_VERSION} 或更新的版本。`,
            },
          });
        }
      }

      const inventoryExit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const server = yield* openCodeRuntime
              .connectToOpenCodeServer({
                binaryPath: input.settings.binaryPath,
                serverUrl: input.settings.serverUrl,
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
                ),
              );
            return yield* openCodeRuntime
              .loadOpenCodeInventory(
                openCodeRuntime.createOpenCodeSdkClient({
                  baseUrl: server.url,
                  directory: input.cwd,
                  ...(isExternalServer && input.settings.serverPassword
                    ? { serverPassword: input.settings.serverPassword }
                    : {}),
                }),
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
                ),
              );
          }),
        ),
      );
      if (inventoryExit._tag === "Failure") {
        return fallback(Cause.squash(inventoryExit.cause), version);
      }

      const models = providerModelsFromSettings(
        flattenOpenCodeModels(inventoryExit.value),
        PROVIDER,
        customModels,
        DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      );
      const connectedCount = inventoryExit.value.providerList.connected.length;
      return buildServerProvider({
        provider: PROVIDER,
        presentation: OPENCODE_PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version,
          status: connectedCount > 0 ? "ready" : "warning",
          auth: {
            status: connectedCount > 0 ? "authenticated" : "unknown",
            type: "opencode",
          },
          message:
            connectedCount > 0
              ? `${connectedCount} 上游提供商${connectedCount === 1 ? "" : "s"} 通过 ${isExternalServer ? "配置的 OpenCode 服务器" : "OpenCode"} 连接。`
              : isExternalServer
                ? "连接到配置的 OpenCode 服务器，但未报告任何连接的上游提供商。"
                : "OpenCode 可用，但未报告任何连接的上游提供商。",
        },
      });
    });

    const getProviderSettings = serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.providers.opencode),
    );

    return yield* makeManagedServerProvider<OpenCodeSettings>({
      getSettings: getProviderSettings.pipe(Effect.orDie),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.opencode),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: makePendingOpenCodeProvider,
      checkProvider: getProviderSettings.pipe(
        Effect.flatMap((settings) =>
          checkOpenCodeProviderStatus({
            settings,
            cwd: serverConfig.cwd,
          }),
        ),
      ),
    });
  }),
);
