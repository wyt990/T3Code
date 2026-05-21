import type { ProjectId, ServerProviderModel } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { WorkspaceExecutionResolver } from "../workspace/Services/WorkspaceExecution.ts";
import { flattenOpenCodeModels } from "./openCodeModelList.ts";
import { OpenCodeRuntime, type OpenCodeInventory } from "./opencodeRuntime.ts";
import { providerModelsFromSettings } from "./providerSnapshot.ts";
import { resolveRemoteOpenCodeBinaryPath } from "./remoteProviderBinary.ts";
import { DEFAULT_OPENCODE_MODEL_CAPABILITIES } from "./openCodeModelList.ts";

const PROVIDER = "opencode" as const;

const emptyOpenCodeInventory = (): OpenCodeInventory =>
  ({
    providerList: { connected: [], all: [], default: {} },
    agents: [],
  }) as OpenCodeInventory;

/**
 * Load OpenCode model inventory from a remote SSH project workspace.
 * Spawns a short-lived remote `opencode serve` with port-forward (same as session start).
 */
export const probeRemoteOpenCodeModels = Effect.fn("probeRemoteOpenCodeModels")(function* (input: {
  readonly connectionId: string;
  readonly projectId: ProjectId;
}) {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const workspaceExecutionResolver = yield* WorkspaceExecutionResolver;
  const openCodeRuntime = yield* OpenCodeRuntime;
  const serverSettings = yield* ServerSettingsService;
  const settings = yield* serverSettings.getSettings;
  const openCodeSettings = settings.providers.opencode;

  const projectShell = yield* projectionSnapshotQuery.getProjectShellById(input.projectId);
  if (Option.isNone(projectShell)) {
    yield* Effect.logWarning("[probeRemoteOpenCodeModels] Project not found", {
      projectId: input.projectId,
    });
    return [];
  }

  const project = projectShell.value;
  if (
    project.transport.type !== "ssh" ||
    project.transport.sshConnectionId !== input.connectionId
  ) {
    yield* Effect.logWarning(
      "[probeRemoteOpenCodeModels] Project is not on the requested SSH connection",
      {
        projectId: input.projectId,
        connectionId: input.connectionId,
      },
    );
    return [];
  }

  const execution = yield* workspaceExecutionResolver.resolveByProjectId(input.projectId);
  const binaryPath = yield* resolveRemoteOpenCodeBinaryPath(execution, openCodeSettings.binaryPath);

  const inventory = yield* Effect.scoped(
    Effect.gen(function* () {
      const server = yield* openCodeRuntime.connectToOpenCodeServer({
        binaryPath,
        serverUrl: null,
        spawn: { kind: "ssh", execution, binaryPath },
      });
      const client = openCodeRuntime.createOpenCodeSdkClient({
        baseUrl: server.url,
        directory: project.workspaceRoot,
      });
      return yield* openCodeRuntime.loadOpenCodeInventory(client);
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Effect.logWarning("[probeRemoteOpenCodeModels] Failed to load remote inventory", {
          connectionId: input.connectionId,
          projectId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
        return emptyOpenCodeInventory();
      }),
    ),
  );

  return providerModelsFromSettings(
    flattenOpenCodeModels(inventory),
    PROVIDER,
    openCodeSettings.customModels,
    DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  );
});
