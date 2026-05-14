import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { OpenError, OpenInEditorInput } from "./editor.ts";
import { AuthAccessStreamEvent } from "./auth.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCheckoutResult,
  GitCommandError,
  GitCreateBranchInput,
  GitCreateBranchResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStatusInput,
  GitStatusResult,
  GitStatusStreamEvent,
} from "./git.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from "./orchestration.ts";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerRefreshClaudeAgentModelsResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";
import { ProviderKind } from "./orchestration.ts";
import { EnvironmentId, ProjectId, TrimmedNonEmptyString, ThreadId } from "./baseSchemas.ts";
import * as V from "./visualization.ts";
import * as CQ from "./codeQuality.ts";
import * as T from "./testing.ts";
import * as EM from "./environmentManagement.ts";
import * as MA from "./multiAgent.ts";
import * as CX from "./context.ts";

// Provider installation schemas
export const InstallMethodId = Schema.Literals([
  "scoop",
  "choco",
  "brew-tap",
  "brew-official",
  "pacman",
  "paru",
  "npm",
  "bun",
  "pnpm",
  "yarn",
  "mise",
  "nix",
  "yolo",
]);
export type InstallMethodId = typeof InstallMethodId.Type;

export const InstallMethodSchema = Schema.Struct({
  id: InstallMethodId,
  label: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
  requiresSudo: Schema.optional(Schema.Boolean),
  isYolo: Schema.optional(Schema.Boolean),
});
export type InstallMethodSchema = typeof InstallMethodSchema.Type;

export const ProviderInstallProgressEvent = Schema.Struct({
  type: Schema.Literals(["started", "progress", "success", "failed", "fallback"]),
  method: InstallMethodId,
  message: TrimmedNonEmptyString,
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  nextMethod: Schema.optional(InstallMethodId),
});
export type ProviderInstallProgressEvent = typeof ProviderInstallProgressEvent.Type;

export const ProviderInstallInput = Schema.Struct({
  provider: ProviderKind,
  preferredMethod: Schema.optional(InstallMethodId),
});
export type ProviderInstallInput = typeof ProviderInstallInput.Type;

export const ProviderGetInstallMethodsResult = Schema.Struct({
  methods: Schema.Array(InstallMethodSchema),
  recommended: Schema.optional(InstallMethodSchema),
});
export type ProviderGetInstallMethodsResult = typeof ProviderGetInstallMethodsResult.Type;

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",

  // Git methods
  gitPull: "git.pull",
  gitRefreshStatus: "git.refreshStatus",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitInit: "git.init",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverRefreshClaudeAgentModels: "server.refreshClaudeAgentModels",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",

  // Streaming subscriptions
  subscribeGitStatus: "subscribeGitStatus",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",

  // Provider installation
  providerGetInstallMethods: "provider.getInstallMethods",
  providerInstall: "provider.install",
  // Claude Code installation
  claudeCodeInstall: "claudeCode.install",
  openCodeInstall: "openCode.install",

  // Visualization methods
  visualizationGetSessionData: "visualization.getSessionData",
  visualizationGetTimelineEvents: "visualization.getTimelineEvents",
  visualizationGetHotspots: "visualization.getHotspots",
  visualizationGetOperationStats: "visualization.getOperationStats",
  visualizationClearSession: "visualization.clearSession",

  // Code quality methods
  codeQualityLearnProjectStyle: "codeQuality.learnProjectStyle",
  codeQualityCheckCode: "codeQuality.checkCode",
  codeQualityDetectTechDebt: "codeQuality.detectTechDebt",
  codeQualityValidateBestPractices: "codeQuality.validateBestPractices",
  codeQualityGetProjectPreferences: "codeQuality.getProjectPreferences",
  codeQualitySetProjectPreferences: "codeQuality.setProjectPreferences",

  // Testing methods
  testingCreateTestSuite: "testing.createTestSuite",
  testingListTestSuites: "testing.listTestSuites",
  testingDeleteTestSuite: "testing.deleteTestSuite",
  testingGenerateTests: "testing.generateTests",
  testingSelectRegressionTests: "testing.selectRegressionTests",
  testingRunTests: "testing.runTests",
  testingGetCoverageReport: "testing.getCoverageReport",

  // Environment management methods
  environmentList: "environment.list",
  environmentGet: "environment.get",
  environmentCreate: "environment.create",
  environmentUpdate: "environment.update",
  environmentDelete: "environment.delete",
  environmentExport: "environment.export",
  environmentImport: "environment.import",
  environmentRefreshDependencyInsights: "environment.refreshDependencyInsights",

  // Multi-agent orchestration
  multiAgentRegisterAgent: "multiAgent.registerAgent",
  multiAgentUnregisterAgent: "multiAgent.unregisterAgent",
  multiAgentSubmitTask: "multiAgent.submitTask",
  multiAgentStartTask: "multiAgent.startTask",
  multiAgentListTasks: "multiAgent.listTasks",
  multiAgentListAgents: "multiAgent.listAgents",
  multiAgentCompleteTask: "multiAgent.completeTask",
  multiAgentFailTask: "multiAgent.failTask",
  multiAgentSetSharedContext: "multiAgent.setSharedContext",
  multiAgentGetAllSharedContext: "multiAgent.getAllSharedContext",
  multiAgentListRoleTemplates: "multiAgent.listRoleTemplates",
  multiAgentUpsertRoleTemplate: "multiAgent.upsertRoleTemplate",
  multiAgentDeleteRoleTemplate: "multiAgent.deleteRoleTemplate",

  // Context awareness
  contextAnalyze: "context.analyze",
  contextGetContextPool: "context.getContextPool",
  contextRefreshContextPool: "context.refreshContextPool",
  contextBuildDependencyGraph: "context.buildDependencyGraph",
  contextAnalyzeChangeImpact: "context.analyzeChangeImpact",
  contextGetSmartSuggestions: "context.getSmartSuggestions",
  contextGetToolTimingPool: "context.getToolTimingPool",
} as const;

/** Create / switch / delete environment profiles (aligned with server handlers). */
export const EnvironmentProfileCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  templateId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type EnvironmentProfileCreateInput = typeof EnvironmentProfileCreateInput.Type;

export const EnvironmentProfileSwitchInput = Schema.Struct({
  profileId: TrimmedNonEmptyString,
  activeEnvironmentId: EnvironmentId,
});
export type EnvironmentProfileSwitchInput = typeof EnvironmentProfileSwitchInput.Type;

export const EnvironmentProfileIdInput = Schema.Struct({
  profileId: TrimmedNonEmptyString,
});
export type EnvironmentProfileIdInput = typeof EnvironmentProfileIdInput.Type;

// Claude Code install input (platform is optional, server will auto-detect)
export const ClaudeCodeInstallInput = Schema.Struct({
  platform: Schema.optional(Schema.Literals(["linux", "darwin", "win32"])),
});
export type ClaudeCodeInstallInput = typeof ClaudeCodeInstallInput.Type;

// Claude Code install result
export const ClaudeCodeInstallResult = Schema.Struct({
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
});
export type ClaudeCodeInstallResult = typeof ClaudeCodeInstallResult.Type;

// OpenCode install input (platform is optional, server will auto-detect)
export const OpenCodeInstallInput = Schema.Struct({
  platform: Schema.optional(Schema.Literals(["linux", "darwin", "win32"])),
});
export type OpenCodeInstallInput = typeof OpenCodeInstallInput.Type;

// OpenCode install result
export const OpenCodeInstallResult = Schema.Struct({
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
});
export type OpenCodeInstallResult = typeof OpenCodeInstallResult.Type;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerProviderUpdatedPayload,
});

export const WsServerRefreshClaudeAgentModelsRpc = Rpc.make(
  WS_METHODS.serverRefreshClaudeAgentModels,
  {
    payload: Schema.Struct({}),
    success: ServerRefreshClaudeAgentModelsResult,
  },
);

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: OpenError,
});

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: FilesystemBrowseError,
});

export const WsSubscribeGitStatusRpc = Rpc.make(WS_METHODS.subscribeGitStatus, {
  payload: GitStatusInput,
  success: GitStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: GitCommandError,
});

export const WsGitRefreshStatusRpc = Rpc.make(WS_METHODS.gitRefreshStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: GitManagerServiceError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: GitCommandError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: GitCommandError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: GitCreateBranchResult,
  error: GitCommandError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: GitCheckoutResult,
  error: GitCommandError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  error: GitCommandError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: OrchestrationGetSnapshotError,
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: OrchestrationGetSnapshotError,
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  stream: true,
});

export const WsProviderGetInstallMethodsRpc = Rpc.make(WS_METHODS.providerGetInstallMethods, {
  payload: Schema.Struct({}),
  success: ProviderGetInstallMethodsResult,
});

export const WsProviderInstallRpc = Rpc.make(WS_METHODS.providerInstall, {
  payload: ProviderInstallInput,
  success: ProviderInstallProgressEvent,
  stream: true,
});

export const WsClaudeCodeInstallRpc = Rpc.make(WS_METHODS.claudeCodeInstall, {
  payload: ClaudeCodeInstallInput,
  success: ClaudeCodeInstallResult,
});

export const WsOpenCodeInstallRpc = Rpc.make(WS_METHODS.openCodeInstall, {
  payload: OpenCodeInstallInput,
  success: OpenCodeInstallResult,
});

// Visualization RPCs
export const WsVisualizationGetSessionDataRpc = Rpc.make(WS_METHODS.visualizationGetSessionData, {
  payload: Schema.Struct({ threadId: ThreadId }),
  success: Schema.Struct({ session: Schema.NullOr(V.VisualizationSession) }),
});

export const WsVisualizationGetTimelineEventsRpc = Rpc.make(
  WS_METHODS.visualizationGetTimelineEvents,
  {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: Schema.Struct({ events: Schema.Array(V.ExecutionEvent) }),
  },
);

export const WsVisualizationGetHotspotsRpc = Rpc.make(WS_METHODS.visualizationGetHotspots, {
  payload: Schema.Struct({ threadId: ThreadId }),
  success: Schema.Struct({ hotspots: Schema.Array(V.PerformanceHotspot) }),
});

export const WsVisualizationGetOperationStatsRpc = Rpc.make(
  WS_METHODS.visualizationGetOperationStats,
  {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: Schema.Struct({ stats: Schema.Array(V.OperationStats) }),
  },
);

export const WsVisualizationClearSessionRpc = Rpc.make(WS_METHODS.visualizationClearSession, {
  payload: Schema.Struct({ threadId: ThreadId }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// Code quality RPCs
export const WsCodeQualityLearnProjectStyleRpc = Rpc.make(WS_METHODS.codeQualityLearnProjectStyle, {
  payload: Schema.Struct({ projectId: TrimmedNonEmptyString }),
  success: Schema.Struct({
    success: Schema.Literal(true),
    profile: CQ.ProjectStyleProfile,
  }),
});

export const WsCodeQualityCheckCodeRpc = Rpc.make(WS_METHODS.codeQualityCheckCode, {
  payload: Schema.Struct({
    code: Schema.String,
    filePath: TrimmedNonEmptyString,
    profile: CQ.ProjectStyleProfile,
  }),
  success: Schema.Struct({ result: CQ.CodeQualityCheckResult }),
});

export const WsCodeQualityDetectTechDebtRpc = Rpc.make(WS_METHODS.codeQualityDetectTechDebt, {
  payload: Schema.Struct({ projectId: TrimmedNonEmptyString }),
  success: Schema.Struct({ debt: Schema.Array(CQ.TechDebtItem) }),
});

export const WsCodeQualityValidateBestPracticesRpc = Rpc.make(
  WS_METHODS.codeQualityValidateBestPractices,
  {
    payload: Schema.Struct({ code: Schema.String, checklist: CQ.BestPracticeChecklist }),
    success: Schema.Struct({ passed: Schema.Boolean, violations: Schema.Array(Schema.String) }),
  },
);

export const WsCodeQualityGetProjectPreferencesRpc = Rpc.make(
  WS_METHODS.codeQualityGetProjectPreferences,
  {
    payload: Schema.Struct({ projectId: TrimmedNonEmptyString }),
    success: CQ.CodeQualityProjectPreferencesValue,
  },
);

export const WsCodeQualitySetProjectPreferencesRpc = Rpc.make(
  WS_METHODS.codeQualitySetProjectPreferences,
  {
    payload: Schema.Struct({
      projectId: TrimmedNonEmptyString,
      preferences: CQ.CodeQualityProjectPreferencesValue,
    }),
    success: Schema.Struct({ success: Schema.Literal(true) }),
  },
);

// Testing RPCs
export const WsTestingCreateTestSuiteRpc = Rpc.make(WS_METHODS.testingCreateTestSuite, {
  payload: Schema.Struct({
    name: TrimmedNonEmptyString,
    projectId: TrimmedNonEmptyString,
    testCases: Schema.Array(T.TestCaseCreateInput),
  }),
  success: Schema.Struct({ suite: T.TestSuite }),
});

export const WsTestingListTestSuitesRpc = Rpc.make(WS_METHODS.testingListTestSuites, {
  payload: Schema.Struct({ projectId: TrimmedNonEmptyString }),
  success: Schema.Struct({ suites: Schema.Array(T.TestSuite) }),
});

export const WsTestingDeleteTestSuiteRpc = Rpc.make(WS_METHODS.testingDeleteTestSuite, {
  payload: Schema.Struct({
    projectId: TrimmedNonEmptyString,
    suiteId: TrimmedNonEmptyString,
  }),
  success: Schema.Struct({ success: Schema.Literal(true) }),
});

export const WsTestingGenerateTestsRpc = Rpc.make(WS_METHODS.testingGenerateTests, {
  payload: T.TestGenerationRequest,
  success: T.TestGenerationResult,
});

export const WsTestingSelectRegressionTestsRpc = Rpc.make(WS_METHODS.testingSelectRegressionTests, {
  payload: Schema.Struct({
    changedFiles: Schema.Array(TrimmedNonEmptyString),
    /** 提供时在工作区内扫描 `*.test.*` / `*.spec.*` 并做启发式匹配 */
    workspaceRoot: Schema.optionalKey(Schema.String),
  }),
  success: T.RegressionTestSelection,
});

export const WsTestingRunTestsRpc = Rpc.make(WS_METHODS.testingRunTests, {
  payload: T.TestRunConfig,
  success: T.TestRunResult,
});

export const WsTestingGetCoverageReportRpc = Rpc.make(WS_METHODS.testingGetCoverageReport, {
  payload: Schema.Struct({
    projectId: TrimmedNonEmptyString,
    /** 工作区根路径；若提供则尝试读取 Vitest `coverage/coverage-summary.json` */
    workspaceRoot: Schema.optionalKey(Schema.String),
    /** 若提供：整包行覆盖率（summary.lines）换算为百分比后须 ≥ 该值，否则 `linesThresholdGate.passed === false` */
    linesCoverageMinPercent: Schema.optionalKey(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(100)),
    ),
    /**
     * 单文件「薄弱」判定：行覆盖率（0–1）×100 **低于** 该值则进入 `weakAreas`（默认 50）。
     * 范围 1–99。
     */
    weakAreaMaxLinesPercent: Schema.optionalKey(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(99)),
    ),
  }),
  success: T.CoverageReport,
});

// Environment management RPCs
export const WsEnvironmentListRpc = Rpc.make(WS_METHODS.environmentList, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ environments: Schema.Array(EM.EnvironmentProfile) }),
});

export const WsEnvironmentGetRpc = Rpc.make(WS_METHODS.environmentGet, {
  payload: EnvironmentProfileIdInput,
  success: EM.EnvironmentProfile,
});

export const WsEnvironmentCreateRpc = Rpc.make(WS_METHODS.environmentCreate, {
  payload: EnvironmentProfileCreateInput,
  success: EM.EnvironmentProfile,
});

export const WsEnvironmentUpdateRpc = Rpc.make(WS_METHODS.environmentUpdate, {
  payload: EnvironmentProfileSwitchInput,
  success: EM.EnvironmentProfile,
});

export const WsEnvironmentDeleteRpc = Rpc.make(WS_METHODS.environmentDelete, {
  payload: EnvironmentProfileIdInput,
  success: Schema.Struct({ success: Schema.Boolean }),
});

export const WsEnvironmentExportRpc = Rpc.make(WS_METHODS.environmentExport, {
  payload: EM.EnvironmentExportRequest,
  success: EM.EnvironmentExportResult,
});

export const WsEnvironmentImportRpc = Rpc.make(WS_METHODS.environmentImport, {
  payload: EM.EnvironmentImportRequest,
  success: EM.EnvironmentImportResult,
});

export const WsEnvironmentRefreshDependencyInsightsRpc = Rpc.make(
  WS_METHODS.environmentRefreshDependencyInsights,
  {
    payload: Schema.Struct({ workspaceRoot: TrimmedNonEmptyString }),
    success: Schema.Struct({
      tree: EM.DependencyTree,
      suggestions: Schema.Array(EM.DependencyUpdateSuggestion),
      auditFindings: Schema.Array(EM.DependencyAuditFinding),
    }),
  },
);

// Multi-agent RPCs
export const WsMultiAgentRegisterAgentRpc = Rpc.make(WS_METHODS.multiAgentRegisterAgent, {
  payload: MA.MultiAgentConfig,
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

export const WsMultiAgentUnregisterAgentRpc = Rpc.make(WS_METHODS.multiAgentUnregisterAgent, {
  payload: Schema.Struct({ agentId: TrimmedNonEmptyString }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

export const WsMultiAgentSubmitTaskRpc = Rpc.make(WS_METHODS.multiAgentSubmitTask, {
  payload: MA.MultiAgentTaskSubmit,
  success: MA.MultiAgentTask,
});

export const WsMultiAgentStartTaskRpc = Rpc.make(WS_METHODS.multiAgentStartTask, {
  payload: Schema.Struct({ taskId: TrimmedNonEmptyString }),
  success: Schema.Struct({
    started: Schema.Boolean,
    providerDispatched: Schema.optional(Schema.Boolean),
    providerDispatchError: Schema.optional(TrimmedNonEmptyString),
  }),
});

export const WsMultiAgentListAgentsRpc = Rpc.make(WS_METHODS.multiAgentListAgents, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ agents: Schema.Array(MA.MultiAgentConfig) }),
});

export const WsMultiAgentCompleteTaskRpc = Rpc.make(WS_METHODS.multiAgentCompleteTask, {
  payload: Schema.Struct({
    taskId: TrimmedNonEmptyString,
    result: Schema.optionalKey(Schema.Unknown),
  }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

export const WsMultiAgentFailTaskRpc = Rpc.make(WS_METHODS.multiAgentFailTask, {
  payload: Schema.Struct({
    taskId: TrimmedNonEmptyString,
    error: TrimmedNonEmptyString,
  }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

export const WsMultiAgentListTasksRpc = Rpc.make(WS_METHODS.multiAgentListTasks, {
  payload: Schema.Struct({
    agentId: Schema.optionalKey(TrimmedNonEmptyString),
    status: Schema.optionalKey(MA.MultiAgentTaskStatus),
  }),
  success: Schema.Struct({ tasks: Schema.Array(MA.MultiAgentTask) }),
});

export const WsMultiAgentSetSharedContextRpc = Rpc.make(WS_METHODS.multiAgentSetSharedContext, {
  payload: Schema.Struct({
    key: TrimmedNonEmptyString,
    value: Schema.Unknown,
  }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

export const WsMultiAgentGetAllSharedContextRpc = Rpc.make(
  WS_METHODS.multiAgentGetAllSharedContext,
  {
    payload: Schema.Struct({}),
    success: Schema.Struct({
      context: Schema.Record(Schema.String, Schema.Unknown),
    }),
  },
);

export const WsMultiAgentListRoleTemplatesRpc = Rpc.make(WS_METHODS.multiAgentListRoleTemplates, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ templates: Schema.Array(MA.MultiAgentRoleTemplate) }),
});

export const WsMultiAgentUpsertRoleTemplateRpc = Rpc.make(WS_METHODS.multiAgentUpsertRoleTemplate, {
  payload: MA.MultiAgentRoleTemplateUpsert,
  success: MA.MultiAgentRoleTemplate,
});

export const WsMultiAgentDeleteRoleTemplateRpc = Rpc.make(WS_METHODS.multiAgentDeleteRoleTemplate, {
  payload: Schema.Struct({ id: TrimmedNonEmptyString }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});

// Context awareness RPCs
export const WsContextAnalyzeRpc = Rpc.make(WS_METHODS.contextAnalyze, {
  payload: CX.ContextAnalysisRequest,
  success: CX.ContextAnalysisResponse,
});

export const WsContextGetContextPoolRpc = Rpc.make(WS_METHODS.contextGetContextPool, {
  payload: Schema.Struct({ projectId: ProjectId }),
  success: CX.ContextPool,
});

export const WsContextRefreshContextPoolRpc = Rpc.make(WS_METHODS.contextRefreshContextPool, {
  payload: Schema.Struct({
    projectId: ProjectId,
    workspaceRoot: TrimmedNonEmptyString,
  }),
  success: CX.ContextPool,
});

export const WsContextBuildDependencyGraphRpc = Rpc.make(WS_METHODS.contextBuildDependencyGraph, {
  payload: Schema.Struct({ workspaceRoot: TrimmedNonEmptyString }),
  success: CX.DependencyGraph,
});

export const WsContextAnalyzeChangeImpactRpc = Rpc.make(WS_METHODS.contextAnalyzeChangeImpact, {
  payload: CX.ContextChangeImpactRequest,
  success: CX.ChangeImpact,
});

export const WsContextGetSmartSuggestionsRpc = Rpc.make(WS_METHODS.contextGetSmartSuggestions, {
  payload: CX.ThreadContext,
  success: Schema.Struct({ suggestions: Schema.Array(CX.SmartSuggestion) }),
});

export const WsContextGetToolTimingPoolRpc = Rpc.make(WS_METHODS.contextGetToolTimingPool, {
  payload: Schema.Struct({ limit: Schema.optional(Schema.Number) }),
  success: CX.ContextToolTimingPool,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerRefreshClaudeAgentModelsRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsFilesystemBrowseRpc,
  WsSubscribeGitStatusRpc,
  WsGitPullRpc,
  WsGitRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsProviderGetInstallMethodsRpc,
  WsProviderInstallRpc,
  WsClaudeCodeInstallRpc,
  WsOpenCodeInstallRpc,

  // Visualization RPCs
  WsVisualizationGetSessionDataRpc,
  WsVisualizationGetTimelineEventsRpc,
  WsVisualizationGetHotspotsRpc,
  WsVisualizationGetOperationStatsRpc,
  WsVisualizationClearSessionRpc,

  // Code quality RPCs
  WsCodeQualityLearnProjectStyleRpc,
  WsCodeQualityCheckCodeRpc,
  WsCodeQualityDetectTechDebtRpc,
  WsCodeQualityValidateBestPracticesRpc,
  WsCodeQualityGetProjectPreferencesRpc,
  WsCodeQualitySetProjectPreferencesRpc,

  // Testing RPCs
  WsTestingCreateTestSuiteRpc,
  WsTestingListTestSuitesRpc,
  WsTestingDeleteTestSuiteRpc,
  WsTestingGenerateTestsRpc,
  WsTestingSelectRegressionTestsRpc,
  WsTestingRunTestsRpc,
  WsTestingGetCoverageReportRpc,

  // Environment management RPCs
  WsEnvironmentListRpc,
  WsEnvironmentGetRpc,
  WsEnvironmentCreateRpc,
  WsEnvironmentUpdateRpc,
  WsEnvironmentDeleteRpc,
  WsEnvironmentExportRpc,
  WsEnvironmentImportRpc,
  WsEnvironmentRefreshDependencyInsightsRpc,

  WsMultiAgentRegisterAgentRpc,
  WsMultiAgentUnregisterAgentRpc,
  WsMultiAgentSubmitTaskRpc,
  WsMultiAgentStartTaskRpc,
  WsMultiAgentListTasksRpc,
  WsMultiAgentListAgentsRpc,
  WsMultiAgentCompleteTaskRpc,
  WsMultiAgentFailTaskRpc,
  WsMultiAgentSetSharedContextRpc,
  WsMultiAgentGetAllSharedContextRpc,
  WsMultiAgentListRoleTemplatesRpc,
  WsMultiAgentUpsertRoleTemplateRpc,
  WsMultiAgentDeleteRoleTemplateRpc,

  WsContextAnalyzeRpc,
  WsContextGetContextPoolRpc,
  WsContextRefreshContextPoolRpc,
  WsContextBuildDependencyGraphRpc,
  WsContextAnalyzeChangeImpactRpc,
  WsContextGetSmartSuggestionsRpc,
  WsContextGetToolTimingPoolRpc,
);
