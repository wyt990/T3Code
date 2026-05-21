import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStatusResult,
  type GitStatusStreamEvent,
  type LocalApi,
  ORCHESTRATION_WS_METHODS,
  type ServerSettingsPatch,
  WS_METHODS,
  type ProviderInstallProgressEvent,
  type ProviderGetInstallMethodsResult,
  type ProviderKind,
  type InstallMethodId,
  type ClaudeCodeInstallResult,
  type OpenCodeInstallResult,
} from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

type RpcInputStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (
        input: RpcInput<TTag>,
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly filesystem: {
    readonly browse: RpcUnaryMethod<typeof WS_METHODS.filesystemBrowse>;
  };
  readonly ssh: {
    readonly listConnections: RpcUnaryNoArgMethod<typeof WS_METHODS.sshListConnections>;
    readonly listDirectory: RpcUnaryMethod<typeof WS_METHODS.sshListDirectory>;
    readonly upsertConnection: RpcUnaryMethod<typeof WS_METHODS.sshUpsertConnection>;
    readonly deleteConnection: RpcUnaryMethod<typeof WS_METHODS.sshDeleteConnection>;
    readonly testConnection: RpcUnaryMethod<typeof WS_METHODS.sshTestConnection>;
    readonly confirmHostKey: RpcUnaryMethod<typeof WS_METHODS.sshConfirmHostKey>;
    readonly listProviderProbes: RpcUnaryMethod<typeof WS_METHODS.sshListProviderProbes>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.gitRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeGitStatus>,
      listener: (status: GitStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly getConnectionProviders: RpcUnaryMethod<typeof WS_METHODS.serverGetConnectionProviders>;
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>;
    readonly refreshClaudeAgentModels: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverRefreshClaudeAgentModels
    >;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly orchestration: {
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>;
    readonly subscribeShell: RpcStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeShell>;
    readonly subscribeThread: RpcInputStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeThread>;
  };
  readonly provider: {
    readonly getInstallMethods: () => Promise<ProviderGetInstallMethodsResult>;
    readonly install: (
      provider: ProviderKind,
      options?: {
        preferredMethod?: InstallMethodId;
        onProgress?: (event: ProviderInstallProgressEvent) => void;
      },
    ) => Promise<void>;
  };
  readonly claudeCode: {
    readonly install: (platform?: "linux" | "darwin" | "win32") => Promise<ClaudeCodeInstallResult>;
  };
  readonly openCode: {
    readonly install: (platform?: "linux" | "darwin" | "win32") => Promise<OpenCodeInstallResult>;
  };
  readonly multiAgent: {
    readonly registerAgent: RpcUnaryMethod<typeof WS_METHODS.multiAgentRegisterAgent>;
    readonly unregisterAgent: RpcUnaryMethod<typeof WS_METHODS.multiAgentUnregisterAgent>;
    readonly submitTask: RpcUnaryMethod<typeof WS_METHODS.multiAgentSubmitTask>;
    readonly startTask: RpcUnaryMethod<typeof WS_METHODS.multiAgentStartTask>;
    readonly listTasks: RpcUnaryMethod<typeof WS_METHODS.multiAgentListTasks>;
    readonly listAgents: RpcUnaryNoArgMethod<typeof WS_METHODS.multiAgentListAgents>;
    readonly completeTask: RpcUnaryMethod<typeof WS_METHODS.multiAgentCompleteTask>;
    readonly failTask: RpcUnaryMethod<typeof WS_METHODS.multiAgentFailTask>;
    readonly setSharedContext: RpcUnaryMethod<typeof WS_METHODS.multiAgentSetSharedContext>;
    readonly getAllSharedContext: RpcUnaryNoArgMethod<
      typeof WS_METHODS.multiAgentGetAllSharedContext
    >;
    readonly listRoleTemplates: RpcUnaryNoArgMethod<typeof WS_METHODS.multiAgentListRoleTemplates>;
    readonly upsertRoleTemplate: RpcUnaryMethod<typeof WS_METHODS.multiAgentUpsertRoleTemplate>;
    readonly deleteRoleTemplate: RpcUnaryMethod<typeof WS_METHODS.multiAgentDeleteRoleTemplate>;
  };
  readonly context: {
    readonly analyze: RpcUnaryMethod<typeof WS_METHODS.contextAnalyze>;
    readonly getContextPool: RpcUnaryMethod<typeof WS_METHODS.contextGetContextPool>;
    readonly refreshContextPool: RpcUnaryMethod<typeof WS_METHODS.contextRefreshContextPool>;
    readonly buildDependencyGraph: RpcUnaryMethod<typeof WS_METHODS.contextBuildDependencyGraph>;
    readonly analyzeChangeImpact: RpcUnaryMethod<typeof WS_METHODS.contextAnalyzeChangeImpact>;
    readonly getSmartSuggestions: RpcUnaryMethod<typeof WS_METHODS.contextGetSmartSuggestions>;
    readonly getToolTimingPool: RpcUnaryMethod<typeof WS_METHODS.contextGetToolTimingPool>;
  };
  readonly visualization: {
    readonly getSessionData: RpcUnaryMethod<typeof WS_METHODS.visualizationGetSessionData>;
    readonly getTimelineEvents: RpcUnaryMethod<typeof WS_METHODS.visualizationGetTimelineEvents>;
    readonly getHotspots: RpcUnaryMethod<typeof WS_METHODS.visualizationGetHotspots>;
    readonly getOperationStats: RpcUnaryMethod<typeof WS_METHODS.visualizationGetOperationStats>;
    readonly clearSession: RpcUnaryMethod<typeof WS_METHODS.visualizationClearSession>;
  };
  readonly codeQuality: {
    readonly learnProjectStyle: RpcUnaryMethod<typeof WS_METHODS.codeQualityLearnProjectStyle>;
    readonly checkCode: RpcUnaryMethod<typeof WS_METHODS.codeQualityCheckCode>;
    readonly detectTechDebt: RpcUnaryMethod<typeof WS_METHODS.codeQualityDetectTechDebt>;
    readonly validateBestPractices: RpcUnaryMethod<
      typeof WS_METHODS.codeQualityValidateBestPractices
    >;
    readonly getProjectPreferences: RpcUnaryMethod<
      typeof WS_METHODS.codeQualityGetProjectPreferences
    >;
    readonly setProjectPreferences: RpcUnaryMethod<
      typeof WS_METHODS.codeQualitySetProjectPreferences
    >;
  };
  readonly testing: {
    readonly createTestSuite: RpcUnaryMethod<typeof WS_METHODS.testingCreateTestSuite>;
    readonly listTestSuites: RpcUnaryMethod<typeof WS_METHODS.testingListTestSuites>;
    readonly deleteTestSuite: RpcUnaryMethod<typeof WS_METHODS.testingDeleteTestSuite>;
    readonly generateTests: RpcUnaryMethod<typeof WS_METHODS.testingGenerateTests>;
    readonly selectRegressionTests: RpcUnaryMethod<typeof WS_METHODS.testingSelectRegressionTests>;
    readonly runTests: RpcUnaryMethod<typeof WS_METHODS.testingRunTests>;
    readonly getCoverageReport: RpcUnaryMethod<typeof WS_METHODS.testingGetCoverageReport>;
  };
  readonly environmentProfiles: {
    readonly list: RpcUnaryNoArgMethod<typeof WS_METHODS.environmentList>;
    readonly get: RpcUnaryMethod<typeof WS_METHODS.environmentGet>;
    readonly create: RpcUnaryMethod<typeof WS_METHODS.environmentCreate>;
    readonly update: RpcUnaryMethod<typeof WS_METHODS.environmentUpdate>;
    readonly delete: RpcUnaryMethod<typeof WS_METHODS.environmentDelete>;
    readonly exportProfile: RpcUnaryMethod<typeof WS_METHODS.environmentExport>;
    readonly importProfile: RpcUnaryMethod<typeof WS_METHODS.environmentImport>;
    readonly refreshDependencyInsights: RpcUnaryMethod<
      typeof WS_METHODS.environmentRefreshDependencyInsights
    >;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    filesystem: {
      browse: (input) => transport.request((client) => client[WS_METHODS.filesystemBrowse](input)),
    },
    ssh: {
      listConnections: () => transport.request((client) => client[WS_METHODS.sshListConnections]()),
      listDirectory: (input) =>
        transport.request((client) => client[WS_METHODS.sshListDirectory](input)),
      upsertConnection: (input) =>
        transport.request((client) => client[WS_METHODS.sshUpsertConnection](input)),
      deleteConnection: (input) =>
        transport.request((client) => client[WS_METHODS.sshDeleteConnection](input)),
      testConnection: (input) =>
        transport.request((client) => client[WS_METHODS.sshTestConnection](input)),
      confirmHostKey: (input) =>
        transport.request((client) => client[WS_METHODS.sshConfirmHostKey](input)),
      listProviderProbes: (input) =>
        transport.request((client) => client[WS_METHODS.sshListProviderProbes](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      pull: (input) => transport.request((client) => client[WS_METHODS.gitPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.gitRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: GitStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeGitStatus](input),
          (event: GitStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          options,
        );
      },
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      listBranches: (input) =>
        transport.request((client) => client[WS_METHODS.gitListBranches](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRemoveWorktree](input)),
      createBranch: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateBranch](input)),
      checkout: (input) => transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      getConnectionProviders: (input) =>
        transport.request((client) => client[WS_METHODS.serverGetConnectionProviders](input)),
      refreshProviders: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders]({})),
      refreshClaudeAgentModels: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshClaudeAgentModels]({})),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeAuthAccess]({}),
          listener,
          options,
        ),
    },
    orchestration: {
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      replayEvents: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.replayEvents](input)),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          options,
        ),
      subscribeThread: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeThread](input),
          listener,
          options,
        ),
    },
    provider: {
      getInstallMethods: () =>
        transport.request((client) => client[WS_METHODS.providerGetInstallMethods]({})),
      install: async (provider, options) => {
        await transport.requestStream(
          (client) =>
            client[WS_METHODS.providerInstall]({
              provider,
              preferredMethod: options?.preferredMethod,
            }),
          options?.onProgress ?? (() => {}),
        );
      },
    },
    claudeCode: {
      install: (platform?: "linux" | "darwin" | "win32") =>
        transport.request((client) => client[WS_METHODS.claudeCodeInstall]({ platform })),
    },
    openCode: {
      install: (platform?: "linux" | "darwin" | "win32") =>
        transport.request((client) => client[WS_METHODS.openCodeInstall]({ platform })),
    },
    multiAgent: {
      registerAgent: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentRegisterAgent](input)),
      unregisterAgent: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentUnregisterAgent](input)),
      submitTask: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentSubmitTask](input)),
      startTask: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentStartTask](input)),
      listTasks: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentListTasks](input)),
      listAgents: () => transport.request((client) => client[WS_METHODS.multiAgentListAgents]({})),
      completeTask: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentCompleteTask](input)),
      failTask: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentFailTask](input)),
      setSharedContext: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentSetSharedContext](input)),
      getAllSharedContext: () =>
        transport.request((client) => client[WS_METHODS.multiAgentGetAllSharedContext]({})),
      listRoleTemplates: () =>
        transport.request((client) => client[WS_METHODS.multiAgentListRoleTemplates]({})),
      upsertRoleTemplate: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentUpsertRoleTemplate](input)),
      deleteRoleTemplate: (input) =>
        transport.request((client) => client[WS_METHODS.multiAgentDeleteRoleTemplate](input)),
    },
    context: {
      analyze: (input) => transport.request((client) => client[WS_METHODS.contextAnalyze](input)),
      getContextPool: (input) =>
        transport.request((client) => client[WS_METHODS.contextGetContextPool](input)),
      refreshContextPool: (input) =>
        transport.request((client) => client[WS_METHODS.contextRefreshContextPool](input)),
      buildDependencyGraph: (input) =>
        transport.request((client) => client[WS_METHODS.contextBuildDependencyGraph](input)),
      analyzeChangeImpact: (input) =>
        transport.request((client) => client[WS_METHODS.contextAnalyzeChangeImpact](input)),
      getSmartSuggestions: (input) =>
        transport.request((client) => client[WS_METHODS.contextGetSmartSuggestions](input)),
      getToolTimingPool: (input) =>
        transport.request((client) => client[WS_METHODS.contextGetToolTimingPool](input)),
    },
    visualization: {
      getSessionData: (input) =>
        transport.request((client) => client[WS_METHODS.visualizationGetSessionData](input)),
      getTimelineEvents: (input) =>
        transport.request((client) => client[WS_METHODS.visualizationGetTimelineEvents](input)),
      getHotspots: (input) =>
        transport.request((client) => client[WS_METHODS.visualizationGetHotspots](input)),
      getOperationStats: (input) =>
        transport.request((client) => client[WS_METHODS.visualizationGetOperationStats](input)),
      clearSession: (input) =>
        transport.request((client) => client[WS_METHODS.visualizationClearSession](input)),
    },
    codeQuality: {
      learnProjectStyle: (input) =>
        transport.request((client) => client[WS_METHODS.codeQualityLearnProjectStyle](input)),
      checkCode: (input) =>
        transport.request((client) => client[WS_METHODS.codeQualityCheckCode](input)),
      detectTechDebt: (input) =>
        transport.request((client) => client[WS_METHODS.codeQualityDetectTechDebt](input)),
      validateBestPractices: (input) =>
        transport.request((client) => client[WS_METHODS.codeQualityValidateBestPractices](input)),
      getProjectPreferences: (input) =>
        transport.request((client) => client[WS_METHODS.codeQualityGetProjectPreferences](input)),
      setProjectPreferences: (input) =>
        transport.request((client) => client[WS_METHODS.codeQualitySetProjectPreferences](input)),
    },
    testing: {
      createTestSuite: (input) =>
        transport.request((client) => client[WS_METHODS.testingCreateTestSuite](input)),
      listTestSuites: (input) =>
        transport.request((client) => client[WS_METHODS.testingListTestSuites](input)),
      deleteTestSuite: (input) =>
        transport.request((client) => client[WS_METHODS.testingDeleteTestSuite](input)),
      generateTests: (input) =>
        transport.request((client) => client[WS_METHODS.testingGenerateTests](input)),
      selectRegressionTests: (input) =>
        transport.request((client) => client[WS_METHODS.testingSelectRegressionTests](input)),
      runTests: (input) => transport.request((client) => client[WS_METHODS.testingRunTests](input)),
      getCoverageReport: (input) =>
        transport.request((client) => client[WS_METHODS.testingGetCoverageReport](input)),
    },
    environmentProfiles: {
      list: () => transport.request((client) => client[WS_METHODS.environmentList]({})),
      get: (input) => transport.request((client) => client[WS_METHODS.environmentGet](input)),
      create: (input) => transport.request((client) => client[WS_METHODS.environmentCreate](input)),
      update: (input) => transport.request((client) => client[WS_METHODS.environmentUpdate](input)),
      delete: (input) => transport.request((client) => client[WS_METHODS.environmentDelete](input)),
      exportProfile: (input) =>
        transport.request((client) => client[WS_METHODS.environmentExport](input)),
      importProfile: (input) =>
        transport.request((client) => client[WS_METHODS.environmentImport](input)),
      refreshDependencyInsights: (input) =>
        transport.request((client) =>
          client[WS_METHODS.environmentRefreshDependencyInsights](input),
        ),
    },
  };
}
