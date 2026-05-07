import { Effect, Layer, Stream } from "effect";
import { resolveAvailableMethods, type InstallMethod } from "@t3tools/shared/installer";
import { runProcess } from "../processRunner.ts";
import {
  buildProxyProcessEnv,
  type InstallMethodSchema,
  type ProviderInstallProgressEvent,
  type ProviderKind,
  type ProxySettings,
} from "@t3tools/contracts";
import { ProviderInstaller } from "./Services/ProviderInstaller.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const NO_PROXY: ProxySettings = { enabled: false, httpProxy: "", httpsProxy: "" };

const INSTALL_TIMEOUT_MS = 120_000; // 2 minutes

function methodToSchema(method: InstallMethod): InstallMethodSchema {
  return {
    id: method.id,
    label: method.label,
    command: method.command,
    args: [...method.args],
    ...(method.requiresSudo ? { requiresSudo: true } : {}),
    ...(method.isYolo ? { isYolo: true } : {}),
  };
}

interface InstallEvents {
  readonly events: ReadonlyArray<ProviderInstallProgressEvent>;
}

function runInstall(
  options?: { preferredMethod?: string },
  proxy?: ProxySettings,
): Effect.Effect<InstallEvents> {
  return Effect.gen(function* () {
    const availableMethods = resolveAvailableMethods(process.platform);
    const events: ProviderInstallProgressEvent[] = [];
    const proxyEnv = proxy ? buildProxyProcessEnv(proxy) : {};

    if (availableMethods.length === 0) {
      events.push({
        type: "failed",
        method: "yolo",
        message: "没有可用的安装方法。请手动安装。",
      });
      return { events };
    }

    // Reorder if preferred method is specified
    let methodsToTry = [...availableMethods];
    if (options?.preferredMethod) {
      const preferredIndex = methodsToTry.findIndex((m) => m.id === options.preferredMethod);
      if (preferredIndex > 0) {
        const preferred = methodsToTry[preferredIndex];
        methodsToTry = [
          preferred!,
          ...methodsToTry.slice(0, preferredIndex),
          ...methodsToTry.slice(preferredIndex + 1),
        ];
      }
    }

    for (let i = 0; i < methodsToTry.length; i++) {
      const method = methodsToTry[i]!;

      // Emit started event
      events.push({
        type: "started",
        method: method.id,
        message: `正在通过 ${method.label} 安装...`,
      });

      const result = yield* Effect.promise(() =>
        runProcess(method.command, method.args, {
          timeoutMs: INSTALL_TIMEOUT_MS,
          allowNonZeroExit: true,
          env: proxyEnv,
        }),
      );

      if (result.code === 0) {
        events.push({
          type: "success",
          method: method.id,
          message: `通过 ${method.label} 安装成功`,
          stdout: result.stdout,
          stderr: result.stderr,
        });
        return { events };
      }

      // Method failed, try fallback
      const nextMethod = methodsToTry[i + 1];
      events.push({
        type: "fallback",
        method: method.id,
        message: `${method.label} 失败。尝试下一个方法...`,
        stderr: result.stderr,
        nextMethod: nextMethod?.id,
      });
    }

    // All methods failed
    const lastMethod = methodsToTry[methodsToTry.length - 1]!;
    events.push({
      type: "failed",
      method: lastMethod.id,
      message: "所有安装方法都失败了。请手动安装。",
    });

    return { events };
  });
}

export const ProviderInstallerLive = Layer.effect(
  ProviderInstaller,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;

    return ProviderInstaller.of({
      getAvailableMethods: Effect.sync(() => {
        const methods = resolveAvailableMethods(process.platform);
        return methods.map(methodToSchema);
      }),

      install: (_provider: ProviderKind, options?) =>
        Stream.unwrap(
          Effect.gen(function* () {
            // If settings can't be read (corrupt file, missing perms), fall back to
            // an unproxied install rather than failing the whole stream — the install
            // path must remain reachable for users trying to recover from a broken
            // settings state.
            const settings = yield* serverSettings.getSettings.pipe(
              Effect.catch(() => Effect.succeed({ proxy: NO_PROXY })),
            );
            const { events } = yield* runInstall(options, settings.proxy);
            return Stream.fromIterable(events);
          }),
        ),
    });
  }),
);
