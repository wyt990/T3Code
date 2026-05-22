import type {
  ProjectId,
  ProviderKind,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import { Effect, Option } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  filterProvidersByConnection,
  replaceProviderModels,
} from "../provider/Layers/ServerProviderFilter.ts";
import {
  DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  getBuiltInClaudeModelsForVersion,
} from "../provider/claudeModelList.ts";
import { DEFAULT_OPENCODE_MODEL_CAPABILITIES } from "../provider/openCodeModelList.ts";
import { buildServerProvider, providerModelsFromSettings } from "../provider/providerSnapshot.ts";
import { probeRemoteOpenCodeModels } from "../provider/remoteOpenCodeModels.ts";
import { SshConnectionPool } from "./Services/SshConnectionPool.ts";
import {
  RemoteProviderProbe,
  refreshRemoteClaudeModelsForConnection,
} from "../provider/remoteProviderProbe.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { formatSshUserMessage } from "./formatSshUserMessage.ts";

const SSH_CHAT_PROVIDER_KINDS = [
  "claudeAgent",
  "opencode",
] as const satisfies ReadonlyArray<ProviderKind>;

const CLAUDE_PRESENTATION = {
  displayName: "Claude",
  showInteractionModeToggle: true,
} as const;

const OPENCODE_PRESENTATION = {
  displayName: "OpenCode",
  showInteractionModeToggle: false,
} as const;

const pickTemplate = (
  globalProviders: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): ServerProvider | undefined => globalProviders.find((entry) => entry.provider === provider);

/** Minimal shell when global registry has no template (still attach SSH model lists). */
export const buildSshChatProviderTemplate = (
  provider: ProviderKind,
  globalProviders: ReadonlyArray<ServerProvider>,
): ServerProvider => {
  const template = pickTemplate(globalProviders, provider);
  if (template) {
    return template;
  }

  const checkedAt = new Date().toISOString();
  return buildServerProvider({
    provider,
    presentation: provider === "claudeAgent" ? CLAUDE_PRESENTATION : OPENCODE_PRESENTATION,
    enabled: true,
    checkedAt,
    models: [],
    probe: {
      installed: false,
      version: null,
      status: "stopped",
      auth: { status: "unknown" },
    },
  });
};

export const resolveSshChatProviderTemplates = (
  globalProviders: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> =>
  SSH_CHAT_PROVIDER_KINDS.map((kind) => buildSshChatProviderTemplate(kind, globalProviders));

const makeUnavailableSshProvider = (input: {
  readonly provider: ProviderKind;
  readonly message: string;
  readonly customModels: ReadonlyArray<string>;
  readonly claudeVersion?: string | null;
  readonly cachedClaudeModels?: ReadonlyArray<ServerProviderModel>;
  readonly probedOpenCodeModels?: ReadonlyArray<ServerProviderModel>;
}): ServerProvider => {
  const models =
    input.provider === "claudeAgent"
      ? resolveSshClaudeAgentModels({
          cachedRemoteModels: input.cachedClaudeModels ?? [],
          customModels: input.customModels,
          claudeVersion: input.claudeVersion ?? null,
        })
      : resolveSshOpenCodeModels({
          probedModels: input.probedOpenCodeModels ?? [],
          customModels: input.customModels,
        });

  return buildServerProvider({
    provider: input.provider,
    presentation: input.provider === "claudeAgent" ? CLAUDE_PRESENTATION : OPENCODE_PRESENTATION,
    enabled: false,
    checkedAt: new Date().toISOString(),
    models,
    probe: {
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: input.message,
    },
  });
};

/** Remote probe may fail transiently (SSH channel contention); keep cached/built-in models for the picker. */
export const resolveSshClaudeAgentModels = (input: {
  readonly cachedRemoteModels: ReadonlyArray<ServerProviderModel>;
  readonly customModels: ReadonlyArray<string>;
  readonly claudeVersion: string | null;
}): ReadonlyArray<ServerProviderModel> => {
  const builtIn = getBuiltInClaudeModelsForVersion(input.claudeVersion);
  const base = input.cachedRemoteModels.length > 0 ? input.cachedRemoteModels : builtIn;
  return providerModelsFromSettings(
    base,
    "claudeAgent",
    input.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );
};

export const resolveSshOpenCodeModels = (input: {
  readonly probedModels: ReadonlyArray<ServerProviderModel>;
  readonly customModels: ReadonlyArray<string>;
}): ReadonlyArray<ServerProviderModel> =>
  input.probedModels.length > 0
    ? input.probedModels
    : providerModelsFromSettings(
        [],
        "opencode",
        input.customModels,
        DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      );

const attachSshProviderModels = (input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly connectionId: string;
  readonly claudeVersion: string | null;
  readonly cachedClaudeModels: ReadonlyArray<ServerProviderModel>;
  readonly openCodeModels: ReadonlyArray<ServerProviderModel>;
  readonly claudeCustomModels: ReadonlyArray<string>;
  readonly openCodeCustomModels: ReadonlyArray<string>;
}): ReadonlyArray<ServerProvider> =>
  input.providers.map((provider) => {
    if (provider.provider === "claudeAgent") {
      const models = resolveSshClaudeAgentModels({
        cachedRemoteModels: input.cachedClaudeModels,
        customModels: input.claudeCustomModels,
        claudeVersion: input.claudeVersion,
      });
      return replaceProviderModels(provider, models);
    }

    if (provider.provider === "opencode") {
      const models = resolveSshOpenCodeModels({
        probedModels: input.openCodeModels,
        customModels: input.openCodeCustomModels,
      });
      return replaceProviderModels(provider, models);
    }

    return provider;
  });

export const getConnectionProvidersForSshProject = (input: {
  readonly connectionId: string;
  readonly projectId: ProjectId;
  readonly invalidate?: boolean;
}) =>
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry;
    const remoteProbe = yield* RemoteProviderProbe;
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const claudeSettings = settings.providers.claudeAgent;
    const openCodeSettings = settings.providers.opencode;

    if (input.invalidate) {
      // Re-probe binaries only; keep cached remote model lists until a new probe succeeds.
      remoteProbe.invalidate(input.connectionId);
    }

    const globalProviders = yield* registry.getProviders;

    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const projectShell = yield* projectionSnapshotQuery.getProjectShellById(input.projectId);
    const workspaceRoot = Option.isSome(projectShell) ? projectShell.value.workspaceRoot : "/";

    const probes = yield* remoteProbe.probeConnection(input.connectionId);
    const claudeProbe = probes.get("claudeAgent");

    if (claudeProbe?.binaryPath) {
      yield* refreshRemoteClaudeModelsForConnection({
        connectionId: input.connectionId,
        binaryPath: claudeProbe.binaryPath,
        version: claudeProbe.version,
      }).pipe(Effect.catch(() => Effect.void));
      const pool = yield* SshConnectionPool;
      yield* pool.releaseIdleLane(input.connectionId, "probe");
    }

    const cachedClaudeModels = remoteProbe.getClaudeModels(input.connectionId) ?? [];

    let openCodeModels = remoteProbe.getOpenCodeModels(input.connectionId, workspaceRoot);
    if (openCodeModels === undefined) {
      openCodeModels = yield* probeRemoteOpenCodeModels({
        connectionId: input.connectionId,
        projectId: input.projectId,
      }).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<ServerProviderModel>)));
      remoteProbe.cacheOpenCodeModels(input.connectionId, workspaceRoot, openCodeModels);
    }

    if (probes.size === 0) {
      const message = "无法连接 SSH 服务器，无法加载远程 Provider 列表。";
      return {
        providers: SSH_CHAT_PROVIDER_KINDS.map((provider) =>
          makeUnavailableSshProvider({
            provider,
            message,
            customModels:
              provider === "claudeAgent"
                ? claudeSettings.customModels
                : openCodeSettings.customModels,
            claudeVersion: claudeProbe?.version ?? null,
            cachedClaudeModels,
            probedOpenCodeModels: openCodeModels,
          }),
        ),
      };
    }

    const templates = resolveSshChatProviderTemplates(globalProviders);
    const filtered = filterProvidersByConnection(templates, probes);

    return {
      providers: attachSshProviderModels({
        providers: filtered,
        connectionId: input.connectionId,
        claudeVersion: claudeProbe?.version ?? null,
        cachedClaudeModels,
        openCodeModels,
        claudeCustomModels: claudeSettings.customModels,
        openCodeCustomModels: openCodeSettings.customModels,
      }),
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const message = formatSshUserMessage(error);
        const serverSettings = yield* ServerSettingsService;
        const settings = yield* serverSettings.getSettings;
        const remoteProbe = yield* RemoteProviderProbe;
        const cachedClaudeModels = remoteProbe.getClaudeModels(input.connectionId) ?? [];
        return {
          providers: SSH_CHAT_PROVIDER_KINDS.map((provider) =>
            makeUnavailableSshProvider({
              provider,
              message,
              customModels:
                provider === "claudeAgent"
                  ? settings.providers.claudeAgent.customModels
                  : settings.providers.opencode.customModels,
              cachedClaudeModels,
            }),
          ),
        };
      }),
    ),
  );
