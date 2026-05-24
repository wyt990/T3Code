import {
  Cause,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Schedule,
  Stream,
} from "effect";
import {
  type AuthAccessStreamEvent,
  AuthSessionId,
  type ClientOrchestrationCommand,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  MessageId,
  MultiAgentProviderDispatch,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  type OrchestrationShellStreamEvent,
  OrchestrationReplayEventsError,
  ORCHESTRATION_WS_METHODS,
  FilesystemBrowseError,
  SshListDirectoryError,
  ProjectId,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  ProjectReadFileError,
  ProjectListDirectoryError,
  ProjectFileStatError,
  ThreadId,
  type TerminalEvent,
  type ProxySettings,
  WS_METHODS,
  WsRpcGroup,
  type ClaudeCodeInstallInput,
  type OpenCodeInstallInput,
  buildProxyProcessEnv,
  resolveEffectiveProxyUrls,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery.ts";
import { ServerConfig } from "./config.ts";
import { GitCore } from "./git/Services/GitCore.ts";
import { GitManager } from "./git/Services/GitManager.ts";
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster.ts";
import { Keybindings } from "./keybindings.ts";
import { Open, resolveAvailableEditors } from "./open.ts";
import { normalizeDispatchCommand } from "./orchestration/Normalizer.ts";
import { runTurnStartCodeQualityGate } from "./codeQuality/turnStartQualityGate.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation.ts";
import {
  fetchClaudeModelsListStrict,
  mergeClaudeAgentSnapshotModels,
} from "./provider/Layers/ClaudeProvider.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import { ProviderInstaller } from "./provider/Services/ProviderInstaller.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { ServerRuntimeStartup } from "./serverRuntimeStartup.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import {
  confirmSshHostKey,
  deleteSshConnection,
  getConnectionProviders,
  listSshConnections,
  listSshDirectory,
  listSshProviderProbes,
  testSshConnection,
  upsertSshConnection,
} from "./ssh/SshRpc.ts";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem.ts";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths.ts";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner.ts";
import { RepositoryIdentityResolver } from "./project/Services/RepositoryIdentityResolver.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import {
  BootstrapCredentialService,
  type BootstrapCredentialChange,
} from "./auth/Services/BootstrapCredentialService.ts";
import {
  SessionCredentialService,
  type SessionCredentialChange,
} from "./auth/Services/SessionCredentialService.ts";
import { respondToAuthError } from "./auth/http.ts";
import { runProcess } from "./processRunner.ts";
import { ExecutionVisualizer } from "./observability/Services/ExecutionVisualizer.ts";
import { CodeQualityGuard } from "./provider/Services/CodeQualityGuard.ts";
import { CodeQualityProjectPreferences } from "./codeQuality/Services/CodeQualityProjectPreferences.ts";
import { TestOrchestrator } from "./testing/Services/TestOrchestrator.ts";
import { EnvironmentManager } from "./environmentManagement/Services/EnvironmentManager.ts";
import { runDependencyAuditInWorkspace } from "./environmentManagement/runDependencyAudit.ts";
import { MultiAgentOrchestrator } from "./orchestration/Services/MultiAgentOrchestrator.ts";
import {
  deleteCustomRoleTemplate,
  listMergedRoleTemplates,
  upsertCustomRoleTemplate,
} from "./orchestration/multiAgentRoleTemplatesFile.ts";
import { buildMultiAgentTurnPrompt } from "./orchestration/multiAgentTurnPrompt.ts";
import { ContextAnalyzer } from "./contextAwareness/Services/ContextAnalyzer.ts";
import { snapshotToolTimingPool } from "./contextAwareness/toolTimingRingBuffer.ts";

// Claude Code install commands by platform
// Note: For Windows, we build the command dynamically to include proxy settings
const CLAUDE_CODE_INSTALL_COMMANDS = {
  linux: {
    command: "bash",
    args: [
      "-c",
      "curl -fsSL https://raw.githubusercontent.com/wyt990/claude-code-haha/main/install/install.sh | bash",
    ],
  },
  darwin: {
    command: "bash",
    args: [
      "-c",
      "curl -fsSL https://raw.githubusercontent.com/wyt990/claude-code-haha/main/install/install.sh | bash",
    ],
  },
} as const;

function installClaudeCode(
  platform?: "linux" | "darwin" | "win32",
  proxy?: ProxySettings,
): Effect.Effect<{ success: boolean; error?: string; stdout?: string; stderr?: string }, never> {
  return Effect.gen(function* () {
    // Auto-detect platform if not provided
    const detectedPlatform = platform ?? (process.platform as "linux" | "darwin" | "win32");

    // Build proxy environment variables for Linux/macOS
    const proxyEnv = proxy ? buildProxyProcessEnv(proxy) : {};

    // @effect-diagnostics-next-line tryCatchInEffectGen:off
    try {
      let result;

      if (detectedPlatform === "win32") {
        // For Windows, download script to temp file and execute with proxy env vars
        const scriptUrl =
          "https://raw.githubusercontent.com/wyt990/claude-code-haha/main/install/install.ps1";
        const tmpDir = process.env.TEMP || process.env.TMP || "C:\\Temp";
        const scriptPath = `${tmpDir}\\claudecode-install-${Date.now()}.ps1`;

        // Build curl command with proxy to download script
        let curlCommand: string;
        const curlProxy =
          proxy?.enabled === true ? resolveEffectiveProxyUrls(proxy).httpsProxy : "";
        if (curlProxy.length > 0) {
          curlCommand = `curl.exe -x "${curlProxy}" -fsSL "${scriptUrl}" -o "${scriptPath}"`;
        } else {
          curlCommand = `curl.exe -fsSL "${scriptUrl}" -o "${scriptPath}"`;
        }

        // Download script to file
        const downloadResult = yield* Effect.promise(() =>
          runProcess("cmd", ["/c", curlCommand], {
            timeoutMs: 60_000,
            allowNonZeroExit: true,
          }),
        );

        if (downloadResult.code !== 0) {
          return {
            success: false,
            error: downloadResult.stderr || `下载安装脚本失败，退出码: ${downloadResult.code}`,
          };
        }

        // Execute the script with proxy environment variables
        // PowerShell Invoke-WebRequest respects HTTP_PROXY and HTTPS_PROXY env vars
        // Note: runProcess already merges with process.env, so we only need to add proxy vars
        // Also ensure LOCALAPPDATA is set (may be undefined in Electron)
        const localAppData =
          process.env.LOCALAPPDATA || process.env.USERPROFILE
            ? `${process.env.USERPROFILE}\\AppData\\Local`
            : undefined;

        const psEnv: Record<string, string> = {
          // Ensure LOCALAPPDATA is set for PowerShell script
          ...(localAppData ? { LOCALAPPDATA: localAppData } : {}),
          ...(proxy?.enabled === true ? buildProxyProcessEnv(proxy) : {}),
        };

        result = yield* Effect.promise(() =>
          runProcess(
            "powershell",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
            {
              timeoutMs: 300_000, // 5 minutes timeout
              allowNonZeroExit: true,
              env: psEnv,
            },
          ),
        );

        // Clean up temp script
        // @effect-diagnostics-next-line tryCatchInEffectGen:off
        try {
          require("fs").unlinkSync(scriptPath);
        } catch {
          // Ignore cleanup errors
        }
      } else {
        // Linux/macOS
        const config = CLAUDE_CODE_INSTALL_COMMANDS[detectedPlatform as "linux" | "darwin"];
        if (!config) {
          return { success: false, error: `不支持的平台: ${detectedPlatform}` };
        }

        result = yield* Effect.promise(() =>
          runProcess(config.command, config.args, {
            timeoutMs: 300_000, // 5 minutes timeout
            allowNonZeroExit: true,
            env: proxyEnv,
          }),
        );
      }

      if (result.code === 0) {
        return {
          success: true,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      }

      return {
        success: false,
        error: result.stderr || `安装失败，退出码: ${result.code}`,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      console.log("[ClaudeCode Install] Error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function isThreadDetailEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.message-sent"
      | "thread.proposed-plan-upserted"
      | "thread.activity-appended"
      | "thread.turn-diff-completed"
      | "thread.reverted"
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

const PROVIDER_STATUS_DEBOUNCE_MS = 200;

function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const makeWsRpcLayer = (currentSessionId: AuthSessionId, wsTraceId: string) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const gitManager = yield* GitManager;
      const git = yield* GitCore;
      const gitStatusBroadcaster = yield* GitStatusBroadcaster;
      const terminalManager = yield* TerminalManager;
      const providerRegistry = yield* ProviderRegistry;
      const providerInstaller = yield* ProviderInstaller;
      const config = yield* ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const serverSettings = yield* ServerSettingsService;
      const startup = yield* ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const codeQualityGuard = yield* CodeQualityGuard;
      const codeQualityProjectPreferences = yield* CodeQualityProjectPreferences;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
      const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment;
      const serverAuth = yield* ServerAuth;
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const sessions = yield* SessionCredentialService;
      const serverCommandId = (tag: string) =>
        CommandId.make(`server:${tag}:${crypto.randomUUID()}`);

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
          clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
        });

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: serverCommandId("setup-script-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.make(crypto.randomUUID()),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });

      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return Schema.is(OrchestrationDispatchCommandError)(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const enrichProjectEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<OrchestrationEvent, never, never> => {
        switch (event.type) {
          case "project.created":
            return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
              Effect.map((repositoryIdentity) => ({
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              })),
            );
          case "project.meta-updated":
            return Effect.gen(function* () {
              const workspaceRoot =
                event.payload.workspaceRoot ??
                (yield* orchestrationEngine.getReadModel()).projects.find(
                  (project) => project.id === event.payload.projectId,
                )?.workspaceRoot ??
                null;
              if (workspaceRoot === null) {
                return event;
              }

              const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
              return {
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              } satisfies OrchestrationEvent;
            });
          default:
            return Effect.succeed(event);
        }
      };

      const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
        Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

      const toShellStreamEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
        switch (event.type) {
          case "project.created":
          case "project.meta-updated":
            return projectionSnapshotQuery.getProjectShellById(event.payload.projectId).pipe(
              Effect.map((project) =>
                Option.map(project, (nextProject) => ({
                  kind: "project-upserted" as const,
                  sequence: event.sequence,
                  project: nextProject,
                })),
              ),
              Effect.catch(() => Effect.succeed(Option.none())),
            );
          case "project.deleted":
            return Effect.succeed(
              Option.some({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: event.payload.projectId,
              }),
            );
          case "thread.deleted":
            return Effect.succeed(
              Option.some({
                kind: "thread-removed" as const,
                sequence: event.sequence,
                threadId: event.payload.threadId,
              }),
            );
          default:
            if (event.aggregateKind !== "thread") {
              return Effect.succeed(Option.none());
            }
            return projectionSnapshotQuery
              .getThreadShellById(ThreadId.make(event.aggregateId))
              .pipe(
                Effect.map((thread) =>
                  Option.map(thread, (nextThread) => ({
                    kind: "thread-upserted" as const,
                    sequence: event.sequence,
                    thread: nextThread,
                  })),
                ),
                Effect.catch(() => Effect.succeed(Option.none())),
              );
        }
      };

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? orchestrationEngine
                  .dispatch({
                    type: "thread.delete",
                    commandId: serverCommandId("bootstrap-thread-delete"),
                    threadId: command.threadId,
                  })
                  .pipe(Effect.ignoreCause({ log: true }))
              : Effect.void;

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: unknown;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail =
              input.error instanceof Error ? input.error.message : "Unknown setup failure.";
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) => {
            const payload = {
              scriptId: input.scriptId,
              scriptName: input.scriptName,
              terminalId: input.terminalId,
              worktreePath: input.worktreePath,
            };
            return Effect.all([
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              }),
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.started",
                summary: "Setup script started",
                createdAt: new Date().toISOString(),
                payload,
                tone: "info",
              }),
            ]).pipe(
              Effect.asVoid,
              Effect.catch((error) =>
                Effect.logWarning(
                  "bootstrap turn start launched setup script but failed to record setup activity",
                  {
                    threadId: command.threadId,
                    worktreePath: input.worktreePath,
                    scriptId: input.scriptId,
                    terminalId: input.terminalId,
                    detail: error.message,
                  },
                ),
              ),
            );
          };

          const runSetupProgram = () =>
            bootstrap?.runSetupScript && targetWorktreePath
              ? (() => {
                  const worktreePath = targetWorktreePath;
                  const requestedAt = new Date().toISOString();
                  return projectSetupScriptRunner
                    .runForThread({
                      threadId: command.threadId,
                      ...(targetProjectId ? { projectId: targetProjectId } : {}),
                      ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                      worktreePath,
                    })
                    .pipe(
                      Effect.matchEffect({
                        onFailure: (error) =>
                          recordSetupScriptLaunchFailure({
                            error,
                            requestedAt,
                            worktreePath,
                          }),
                        onSuccess: (setupResult) => {
                          if (setupResult.status !== "started") {
                            return Effect.void;
                          }
                          return recordSetupScriptStarted({
                            requestedAt,
                            worktreePath,
                            scriptId: setupResult.scriptId,
                            scriptName: setupResult.scriptName,
                            terminalId: setupResult.terminalId,
                          });
                        },
                      }),
                    );
                })()
              : Effect.void;

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* orchestrationEngine.dispatch({
                type: "thread.create",
                commandId: serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              const worktree = yield* git.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                branch: bootstrap.prepareWorktree.baseBranch,
                newBranch: bootstrap.prepareWorktree.branch,
                path: null,
              });
              targetWorktreePath = worktree.worktree.path;
              yield* orchestrationEngine.dispatch({
                type: "thread.meta.update",
                commandId: serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.branch,
                worktreePath: targetWorktreePath,
              });
              yield* refreshGitStatus(targetWorktreePath);
            }

            yield* runSetupProgram();

            return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : orchestrationEngine
                .dispatch(normalizedCommand)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = yield* serverSettings.getSettings;
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();

        return {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors: resolveAvailableEditors(),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
        };
      });

      const refreshGitStatus = (cwd: string) =>
        gitStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            Effect.gen(function* () {
              const normalizedCommand = yield* normalizeDispatchCommand(command);
              if (
                normalizedCommand.type === "thread.turn.start" &&
                normalizedCommand.codeQualityGate !== undefined
              ) {
                const threadShellForPrefs = yield* projectionSnapshotQuery
                  .getThreadShellById(normalizedCommand.threadId)
                  .pipe(Effect.catch(() => Effect.succeed(Option.none())));
                if (Option.isSome(threadShellForPrefs)) {
                  yield* codeQualityProjectPreferences.mergeFromTurnStartGate(
                    threadShellForPrefs.value.projectId,
                    normalizedCommand.codeQualityGate,
                  );
                }
              }
              let codeQualityTurnGate:
                | import("@t3tools/contracts").CodeQualityTurnGateDispatchSummary
                | undefined;
              if (
                normalizedCommand.type === "thread.turn.start" &&
                normalizedCommand.codeQualityGate &&
                normalizedCommand.codeQualityGate.mode !== "off"
              ) {
                const threadShell = yield* projectionSnapshotQuery
                  .getThreadShellById(normalizedCommand.threadId)
                  .pipe(Effect.catch(() => Effect.succeed(Option.none())));
                if (Option.isNone(threadShell)) {
                  codeQualityTurnGate = {
                    outcome: "skipped_no_thread",
                    checkedSnippets: 0,
                    messages: [],
                  };
                } else {
                  codeQualityTurnGate = yield* runTurnStartCodeQualityGate({
                    command: normalizedCommand,
                    projectId: threadShell.value.projectId,
                    guard: codeQualityGuard,
                  });
                }
              }
              const shouldStopSessionAfterArchive =
                normalizedCommand.type === "thread.archive"
                  ? yield* projectionSnapshotQuery
                      .getThreadShellById(normalizedCommand.threadId)
                      .pipe(
                        Effect.map(
                          Option.match({
                            onNone: () => false,
                            onSome: (thread) =>
                              thread.session !== null && thread.session.status !== "stopped",
                          }),
                        ),
                        Effect.catch(() => Effect.succeed(false)),
                      )
                  : false;
              const result = yield* dispatchNormalizedCommand(normalizedCommand);
              if (normalizedCommand.type === "thread.archive") {
                if (shouldStopSessionAfterArchive) {
                  yield* Effect.gen(function* () {
                    const stopCommand = yield* normalizeDispatchCommand({
                      type: "thread.session.stop",
                      commandId: CommandId.make(
                        `session-stop-for-archive:${normalizedCommand.commandId}`,
                      ),
                      threadId: normalizedCommand.threadId,
                      createdAt: new Date().toISOString(),
                    });

                    yield* dispatchNormalizedCommand(stopCommand);
                  }).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("failed to stop provider session during archive", {
                        threadId: normalizedCommand.threadId,
                        cause,
                      }),
                    ),
                  );
                }

                yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to close thread terminals after archive", {
                      threadId: normalizedCommand.threadId,
                      error: error.message,
                    }),
                  ),
                );
              }
              return codeQualityTurnGate !== undefined
                ? { ...result, codeQualityTurnGate }
                : result;
            }).pipe(
              Effect.mapError((cause) =>
                Schema.is(OrchestrationDispatchCommandError)(cause)
                  ? cause
                  : new OrchestrationDispatchCommandError({
                      message: "Failed to dispatch orchestration command",
                      cause,
                    }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            checkpointDiffQuery.getTurnDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            checkpointDiffQuery.getFullThreadDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) => {
          const fromSequenceExclusive = clamp(input.fromSequenceExclusive, {
            maximum: Number.MAX_SAFE_INTEGER,
            minimum: 0,
          });
          return observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEvents,
            Stream.runCollect(orchestrationEngine.readEvents(fromSequenceExclusive)).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.flatMap(enrichOrchestrationEvents),
              Effect.tap((events) => {
                const maxReturnedSequence =
                  events.length === 0
                    ? undefined
                    : Math.max(...events.map((event) => event.sequence));
                return Effect.logInfo(
                  `【中断重连】编排事件重放：客户端请求 fromSequenceExclusive=${fromSequenceExclusive}（严格大于该序号的已提交事件将被返回），本响应事件数=${events.length}。若为 0，通常表示客户端投影序号已与服务器对齐或尚无更新。wsTraceId=${wsTraceId}${
                    maxReturnedSequence !== undefined
                      ? ` maxReturnedSequence=${maxReturnedSequence}`
                      : ""
                  }`,
                );
              }),
              Effect.mapError(
                (cause) =>
                  new OrchestrationReplayEventsError({
                    message: "Failed to replay orchestration events",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          );
        },
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (_input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeShell,
            Effect.gen(function* () {
              const snapshot = yield* projectionSnapshotQuery.getShellSnapshot().pipe(
                Effect.mapError(
                  (cause) =>
                    new OrchestrationGetSnapshotError({
                      message: "Failed to load orchestration shell snapshot",
                      cause,
                    }),
                ),
              );

              yield* Effect.logInfo(
                `【中断重连】编排 Shell 流：即将下发初始快照；snapshotSequence=${snapshot.snapshotSequence}，线程数=${snapshot.threads.length}，项目数=${snapshot.projects.length}。wsTraceId=${wsTraceId}。断线重连后客户端应重新建立此流以校准侧边栏与线程列表。`,
              );

              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.mapEffect(toShellStreamEvent),
                Stream.flatMap((event) =>
                  Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
                ),
              );

              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot,
                }),
                liveStream,
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeThread,
            Effect.gen(function* () {
              const [threadDetail, snapshotSequence] = yield* Effect.all([
                projectionSnapshotQuery.getThreadDetailById(input.threadId).pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: `Failed to load thread ${input.threadId}`,
                        cause,
                      }),
                  ),
                ),
                orchestrationEngine
                  .getReadModel()
                  .pipe(Effect.map((readModel) => readModel.snapshotSequence)),
              ]);

              if (Option.isNone(threadDetail)) {
                return yield* new OrchestrationGetSnapshotError({
                  message: `Thread ${input.threadId} was not found`,
                  cause: input.threadId,
                });
              }

              const thread = threadDetail.value;
              yield* Effect.logInfo(
                `【中断重连】编排线程流：即将下发初始快照；threadId=${input.threadId}，readModelSnapshotSequence=${snapshotSequence}，消息条数=${thread.messages.length}，latestTurn.state=${thread.latestTurn?.state ?? "null"}，session.status=${thread.session?.status ?? "null"}。wsTraceId=${wsTraceId}。断线重连后若未重新订阅此流，前端会一直停留在旧 UI（例如卡在「工作中」）。`,
              );

              const liveStream = orchestrationEngine.streamDomainEvents.pipe(
                Stream.filter(
                  (event) =>
                    event.aggregateKind === "thread" &&
                    event.aggregateId === input.threadId &&
                    isThreadDetailEvent(event),
                ),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
              );

              // Heartbeat stream - sends a heartbeat every 30 seconds to keep the connection alive
              const heartbeatStream = Stream.repeat(
                Stream.make({
                  kind: "heartbeat" as const,
                  timestamp: new Date().toISOString(),
                }),
                Schedule.spaced(Duration.seconds(30)),
              );

              return Stream.concat(
                Stream.make({
                  kind: "snapshot" as const,
                  snapshot: {
                    snapshotSequence,
                    thread,
                  },
                }),
                Stream.merge(liveStream, heartbeatStream),
              );
            }),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshProviders]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverRefreshClaudeAgentModels]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshClaudeAgentModels,
            Effect.gen(function* () {
              const registry = yield* ProviderRegistry;
              const serverSettingsSvc = yield* ServerSettingsService;
              const settings = yield* serverSettingsSvc.getSettings;
              const providers = yield* registry.getProviders;
              const existing = providers.find((candidate) => candidate.provider === "claudeAgent");
              if (!existing) {
                return {
                  ok: false as const,
                  error: "当前没有 Claude 提供商快照，请稍后重试。",
                };
              }
              const binaryPath = settings.providers.claudeAgent.binaryPath.trim();
              if (!binaryPath) {
                return { ok: false as const, error: "未配置 Claude 二进制路径。" };
              }
              const cliModelsExit = yield* fetchClaudeModelsListStrict(binaryPath).pipe(
                Effect.exit,
              );
              if (Exit.isFailure(cliModelsExit)) {
                const err = Cause.squash(cliModelsExit.cause);
                return {
                  ok: false as const,
                  error: err instanceof Error ? err.message : String(err),
                };
              }
              const merged = mergeClaudeAgentSnapshotModels({
                existing,
                cliModels: cliModelsExit.value,
                customModels: settings.providers.claudeAgent.customModels,
              });
              const nextProviders = yield* registry.upsertProvider(merged);
              return { ok: true as const, providers: nextProviders };
            }).pipe(
              Effect.catch((error: unknown) =>
                Effect.succeed({
                  ok: false as const,
                  error: error instanceof Error ? error.message : String(error),
                }),
              ),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            Effect.gen(function* () {
              const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
              return { keybindings: keybindingsConfig, issues: [] };
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.providerGetInstallMethods]: (_input) =>
          observeRpcEffect(
            WS_METHODS.providerGetInstallMethods,
            Effect.gen(function* () {
              const methods = yield* providerInstaller.getAvailableMethods;
              return { methods, recommended: methods[0] };
            }),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.providerInstall]: (input) =>
          observeRpcStream(
            WS_METHODS.providerInstall,
            providerInstaller.install(
              input.provider,
              input.preferredMethod ? { preferredMethod: input.preferredMethod } : undefined,
            ),
            { "rpc.aggregate": "provider" },
          ),
        [WS_METHODS.claudeCodeInstall]: (input: ClaudeCodeInstallInput) =>
          observeRpcEffect(
            WS_METHODS.claudeCodeInstall,
            Effect.gen(function* () {
              // Settings read may fail (corrupt file, missing perms); fall back to an
              // unproxied install rather than surfacing infra errors as RPC failures.
              const settings = yield* serverSettings.getSettings.pipe(
                Effect.catch(() =>
                  Effect.succeed({ proxy: { enabled: false, httpProxy: "", httpsProxy: "" } }),
                ),
              );
              return yield* installClaudeCode(
                input.platform,
                settings.proxy ?? { enabled: false, httpProxy: "", httpsProxy: "" },
              );
            }),
            { "rpc.aggregate": "claudecode" },
          ),
        [WS_METHODS.openCodeInstall]: (input: OpenCodeInstallInput) =>
          observeRpcEffect(
            WS_METHODS.openCodeInstall,
            Effect.gen(function* () {
              // Use the provider installer which already supports npm with fallback and proxy
              const events: {
                type: string;
                method: string;
                message: string;
                stdout?: string | undefined;
                stderr?: string | undefined;
              }[] = [];
              const stream = providerInstaller.install("opencode", { preferredMethod: "npm" });
              yield* Stream.runForEach(stream, (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
              );
              const lastEvent = events.at(-1);
              if (lastEvent?.type === "success") {
                return { success: true, stdout: lastEvent.stdout, stderr: lastEvent.stderr };
              }
              const failedEvent = events.find((e) => e.type === "failed");
              return {
                success: false,
                error: failedEvent?.message || "安装失败",
                stdout: lastEvent?.stdout,
                stderr: lastEvent?.stderr || failedEvent?.stderr,
              };
            }),
            { "rpc.aggregate": "opencode" },
          ),

        // Multi-agent orchestration
        [WS_METHODS.multiAgentRegisterAgent]: (config) =>
          observeRpcEffect(
            WS_METHODS.multiAgentRegisterAgent,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              yield* orch.registerAgent({
                id: config.id,
                role: config.role,
                name: config.name,
                capabilities: [...config.capabilities],
                maxConcurrentTasks: config.maxConcurrentTasks,
              });
              return { ok: true as const };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentUnregisterAgent]: ({ agentId }) =>
          observeRpcEffect(
            WS_METHODS.multiAgentUnregisterAgent,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              yield* orch.unregisterAgent(agentId);
              return { ok: true as const };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentSubmitTask]: (task) =>
          observeRpcEffect(
            WS_METHODS.multiAgentSubmitTask,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              const created = yield* orch.submitTask({
                id: task.id,
                agentId: task.agentId,
                role: task.role,
                dependencies: [...task.dependencies],
                payload: task.payload,
              });
              return created;
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentStartTask]: ({ taskId }) =>
          observeRpcEffect(
            WS_METHODS.multiAgentStartTask,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              const started = yield* orch.startTask(taskId);
              if (!started) {
                return { started: false as const };
              }
              const task = yield* orch.getTask(taskId);
              if (!task) {
                return { started: true as const };
              }
              const payload = task.payload;
              if (typeof payload !== "object" || payload === null) {
                return { started: true as const, providerDispatched: false as const };
              }
              const rawPd = (payload as { providerDispatch?: unknown }).providerDispatch;
              if (rawPd === undefined) {
                return { started: true as const, providerDispatched: false as const };
              }
              const dispatchDecode = Schema.decodeUnknownExit(MultiAgentProviderDispatch)(rawPd);
              if (dispatchDecode._tag === "Failure") {
                return {
                  started: true as const,
                  providerDispatched: false as const,
                  providerDispatchError: "invalid_provider_dispatch",
                };
              }
              const dispatch = dispatchDecode.value;
              const threadShell = yield* projectionSnapshotQuery
                .getThreadShellById(dispatch.threadId)
                .pipe(Effect.catch(() => Effect.succeed(Option.none())));
              if (Option.isNone(threadShell)) {
                return {
                  started: true as const,
                  providerDispatched: false as const,
                  providerDispatchError: "unknown_thread",
                };
              }
              if (threadShell.value.projectId !== dispatch.projectId) {
                return {
                  started: true as const,
                  providerDispatched: false as const,
                  providerDispatchError: "project_thread_mismatch",
                };
              }
              const shared = yield* orch.getAllSharedContext();
              const depResults: { id: string; result?: unknown }[] = [];
              for (const depId of task.dependencies) {
                const depTask = yield* orch.getTask(depId);
                if (depTask) {
                  depResults.push({ id: depId, result: depTask.result });
                }
              }
              const userText = buildMultiAgentTurnPrompt({
                task,
                sharedContext: shared,
                dependencyResults: depResults,
                explicitPrompt: dispatch.prompt,
              });
              const command = {
                type: "thread.turn.start" as const,
                commandId: serverCommandId("multi-agent-turn"),
                threadId: dispatch.threadId,
                message: {
                  messageId: MessageId.make(crypto.randomUUID()),
                  role: "user" as const,
                  text: userText,
                  attachments: [],
                },
                ...(dispatch.modelSelection !== undefined
                  ? { modelSelection: dispatch.modelSelection }
                  : {}),
                runtimeMode: dispatch.runtimeMode ?? DEFAULT_RUNTIME_MODE,
                interactionMode: dispatch.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
                codeQualityGate: { mode: "off" as const },
                createdAt: new Date().toISOString(),
              } satisfies ClientOrchestrationCommand;
              const normExit = yield* normalizeDispatchCommand(command).pipe(Effect.exit);
              if (Exit.isFailure(normExit)) {
                const err = Cause.squash(normExit.cause);
                const msg =
                  err instanceof OrchestrationDispatchCommandError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "normalize_failed";
                return {
                  started: true as const,
                  providerDispatched: false as const,
                  providerDispatchError: msg,
                };
              }
              const normalizedCommand = normExit.value;
              const dispatchExit = yield* dispatchNormalizedCommand(normalizedCommand).pipe(
                Effect.exit,
              );
              if (Exit.isFailure(dispatchExit)) {
                const err = Cause.squash(dispatchExit.cause);
                const msg =
                  err instanceof OrchestrationDispatchCommandError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "dispatch_failed";
                return {
                  started: true as const,
                  providerDispatched: false as const,
                  providerDispatchError: msg,
                };
              }
              return { started: true as const, providerDispatched: true as const };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentListTasks]: (filters) =>
          observeRpcEffect(
            WS_METHODS.multiAgentListTasks,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              const tasks = yield* orch.listTasks(filters);
              return { tasks: [...tasks] };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentListAgents]: () =>
          observeRpcEffect(
            WS_METHODS.multiAgentListAgents,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              const agents = yield* orch.listAgents();
              return { agents: [...agents] };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentCompleteTask]: ({ taskId, result }) =>
          observeRpcEffect(
            WS_METHODS.multiAgentCompleteTask,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              yield* orch.completeTask(taskId, result);
              return { ok: true as const };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentFailTask]: ({ taskId, error }) =>
          observeRpcEffect(
            WS_METHODS.multiAgentFailTask,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              yield* orch.failTask(taskId, error);
              return { ok: true as const };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentSetSharedContext]: ({ key, value }) =>
          observeRpcEffect(
            WS_METHODS.multiAgentSetSharedContext,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              yield* orch.setSharedContext(key, value);
              return { ok: true as const };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentGetAllSharedContext]: () =>
          observeRpcEffect(
            WS_METHODS.multiAgentGetAllSharedContext,
            Effect.gen(function* () {
              const orch = yield* MultiAgentOrchestrator;
              const context = yield* orch.getAllSharedContext();
              return { context };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentListRoleTemplates]: () =>
          observeRpcEffect(
            WS_METHODS.multiAgentListRoleTemplates,
            Effect.gen(function* () {
              const templates = yield* listMergedRoleTemplates;
              return { templates: [...templates] };
            }),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentUpsertRoleTemplate]: (input) =>
          observeRpcEffect(
            WS_METHODS.multiAgentUpsertRoleTemplate,
            Effect.gen(function* () {
              const saved = yield* upsertCustomRoleTemplate(input);
              return saved;
            }).pipe(Effect.tapError(Effect.logError), Effect.orDie),
            { "rpc.aggregate": "multiAgent" },
          ),
        [WS_METHODS.multiAgentDeleteRoleTemplate]: ({ id }) =>
          observeRpcEffect(
            WS_METHODS.multiAgentDeleteRoleTemplate,
            Effect.gen(function* () {
              yield* deleteCustomRoleTemplate(id);
              return { ok: true as const };
            }).pipe(Effect.tapError(Effect.logError), Effect.orDie),
            { "rpc.aggregate": "multiAgent" },
          ),

        // Context awareness
        [WS_METHODS.contextAnalyze]: (request) =>
          observeRpcEffect(
            WS_METHODS.contextAnalyze,
            Effect.gen(function* () {
              const analyzer = yield* ContextAnalyzer;
              return yield* analyzer.analyzeContext(request);
            }),
            { "rpc.aggregate": "context" },
          ) as any,
        [WS_METHODS.contextGetContextPool]: ({ projectId }) =>
          observeRpcEffect(
            WS_METHODS.contextGetContextPool,
            Effect.gen(function* () {
              const analyzer = yield* ContextAnalyzer;
              return yield* analyzer.getContextPool(projectId);
            }),
            { "rpc.aggregate": "context" },
          ) as any,
        [WS_METHODS.contextRefreshContextPool]: ({ projectId, workspaceRoot }) =>
          observeRpcEffect(
            WS_METHODS.contextRefreshContextPool,
            Effect.gen(function* () {
              const analyzer = yield* ContextAnalyzer;
              return yield* analyzer.refreshContextPool(projectId, workspaceRoot);
            }),
            { "rpc.aggregate": "context" },
          ) as any,
        [WS_METHODS.contextBuildDependencyGraph]: ({ workspaceRoot }) =>
          observeRpcEffect(
            WS_METHODS.contextBuildDependencyGraph,
            Effect.gen(function* () {
              const analyzer = yield* ContextAnalyzer;
              return yield* analyzer.buildDependencyGraph(workspaceRoot);
            }),
            { "rpc.aggregate": "context" },
          ) as any,
        [WS_METHODS.contextAnalyzeChangeImpact]: (payload) =>
          observeRpcEffect(
            WS_METHODS.contextAnalyzeChangeImpact,
            Effect.gen(function* () {
              const analyzer = yield* ContextAnalyzer;
              const graph = yield* analyzer.buildDependencyGraph(payload.workspaceRoot);
              const hopArg =
                payload.maxReverseImportHops === undefined
                  ? {}
                  : { maxReverseImportHops: payload.maxReverseImportHops };
              return yield* analyzer.analyzeChangeImpact({
                changedFile: payload.changedFile,
                dependencyGraph: graph,
                ...hopArg,
              });
            }),
            { "rpc.aggregate": "context" },
          ) as any,
        [WS_METHODS.contextGetSmartSuggestions]: (threadContext) =>
          observeRpcEffect(
            WS_METHODS.contextGetSmartSuggestions,
            Effect.gen(function* () {
              const analyzer = yield* ContextAnalyzer;
              const suggestions = yield* analyzer.getSmartSuggestions(threadContext);
              return { suggestions };
            }),
            { "rpc.aggregate": "context" },
          ) as any,
        [WS_METHODS.contextGetToolTimingPool]: (payload) =>
          observeRpcEffect(
            WS_METHODS.contextGetToolTimingPool,
            Effect.sync(() => snapshotToolTimingPool(payload.limit)),
            { "rpc.aggregate": "context" },
          ) as any,

        // Visualization methods
        [WS_METHODS.visualizationGetSessionData]: ({ threadId }) =>
          observeRpcEffect(
            WS_METHODS.visualizationGetSessionData,
            Effect.gen(function* () {
              const visualizer = yield* ExecutionVisualizer;
              const session = yield* visualizer.getSessionData(threadId);
              return { session };
            }),
            { "rpc.aggregate": "visualization" },
          ),
        [WS_METHODS.visualizationGetTimelineEvents]: ({ threadId }) =>
          observeRpcEffect(
            WS_METHODS.visualizationGetTimelineEvents,
            Effect.gen(function* () {
              const visualizer = yield* ExecutionVisualizer;
              const events = yield* visualizer.getTimelineEvents(threadId);
              return { events };
            }),
            { "rpc.aggregate": "visualization" },
          ),
        [WS_METHODS.visualizationGetHotspots]: ({ threadId }) =>
          observeRpcEffect(
            WS_METHODS.visualizationGetHotspots,
            Effect.gen(function* () {
              const visualizer = yield* ExecutionVisualizer;
              const hotspots = yield* visualizer.calculateHotspots(threadId);
              return { hotspots };
            }),
            { "rpc.aggregate": "visualization" },
          ),
        [WS_METHODS.visualizationGetOperationStats]: ({ threadId }) =>
          observeRpcEffect(
            WS_METHODS.visualizationGetOperationStats,
            Effect.gen(function* () {
              const visualizer = yield* ExecutionVisualizer;
              const stats = yield* visualizer.getOperationStats(threadId);
              return { stats };
            }),
            { "rpc.aggregate": "visualization" },
          ),
        [WS_METHODS.visualizationClearSession]: ({ threadId }) =>
          observeRpcEffect(
            WS_METHODS.visualizationClearSession,
            Effect.gen(function* () {
              const visualizer = yield* ExecutionVisualizer;
              yield* visualizer.clearSession(threadId);
              return { success: true };
            }),
            { "rpc.aggregate": "visualization" },
          ),

        // Code quality methods
        [WS_METHODS.codeQualityLearnProjectStyle]: ({ projectId }) =>
          observeRpcEffect(
            WS_METHODS.codeQualityLearnProjectStyle,
            Effect.gen(function* () {
              const guard = yield* CodeQualityGuard;
              const shellOpt = yield* projectionSnapshotQuery.getProjectShellById(
                ProjectId.make(projectId),
              );
              let files: string[] = [];
              if (Option.isSome(shellOpt)) {
                const cwd = shellOpt.value.workspaceRoot;
                const searchExit = yield* Effect.exit(
                  workspaceEntries.search({ cwd, query: ".", limit: 200 }),
                );
                const searched = Exit.isSuccess(searchExit)
                  ? searchExit.value
                  : { entries: [], truncated: false as const };
                files = [...searched.entries]
                  .filter((e) => e.kind === "file")
                  .map((e) => e.path.replace(/\\/g, "/"));
              }
              const profile = yield* guard.learnProjectStyle(projectId, files);
              return { success: true as const, profile };
            }),
            { "rpc.aggregate": "codequality" },
          ) as any,
        [WS_METHODS.codeQualityCheckCode]: (params) =>
          observeRpcEffect(
            WS_METHODS.codeQualityCheckCode,
            Effect.gen(function* () {
              const guard = yield* CodeQualityGuard;
              const result = yield* guard.checkCodeQuality(params);
              return { result };
            }),
            { "rpc.aggregate": "codequality" },
          ),
        [WS_METHODS.codeQualityDetectTechDebt]: ({ projectId }) =>
          observeRpcEffect(
            WS_METHODS.codeQualityDetectTechDebt,
            Effect.gen(function* () {
              const guard = yield* CodeQualityGuard;
              const debt = yield* guard.detectTechDebt(projectId);
              return { debt };
            }),
            { "rpc.aggregate": "codequality" },
          ) as any,
        [WS_METHODS.codeQualityValidateBestPractices]: (params) =>
          observeRpcEffect(
            WS_METHODS.codeQualityValidateBestPractices,
            Effect.gen(function* () {
              const guard = yield* CodeQualityGuard;
              return yield* guard.validateBestPractices(params);
            }),
            { "rpc.aggregate": "codequality" },
          ),
        [WS_METHODS.codeQualityGetProjectPreferences]: ({ projectId }) =>
          observeRpcEffect(
            WS_METHODS.codeQualityGetProjectPreferences,
            Effect.gen(function* () {
              const prefs = yield* CodeQualityProjectPreferences;
              return yield* prefs.getForProject(projectId);
            }),
            { "rpc.aggregate": "codequality" },
          ),
        [WS_METHODS.codeQualitySetProjectPreferences]: ({ projectId, preferences }) =>
          observeRpcEffect(
            WS_METHODS.codeQualitySetProjectPreferences,
            Effect.gen(function* () {
              const prefs = yield* CodeQualityProjectPreferences;
              yield* prefs.setForProject(projectId, preferences);
              return { success: true as const };
            }),
            { "rpc.aggregate": "codequality" },
          ),

        // Testing methods
        [WS_METHODS.testingCreateTestSuite]: (params) =>
          observeRpcEffect(
            WS_METHODS.testingCreateTestSuite,
            Effect.gen(function* () {
              const orchestrator = yield* TestOrchestrator;
              const suite = yield* orchestrator.createTestSuite({
                name: params.name,
                projectId: params.projectId,
                testCases: [...params.testCases],
              });
              return { suite };
            }),
            { "rpc.aggregate": "testing" },
          ) as any,
        [WS_METHODS.testingListTestSuites]: ({ projectId }) =>
          observeRpcEffect(
            WS_METHODS.testingListTestSuites,
            Effect.gen(function* () {
              const orchestrator = yield* TestOrchestrator;
              const suites = yield* orchestrator.listTestSuites(projectId);
              return { suites: [...suites] };
            }),
            { "rpc.aggregate": "testing" },
          ) as any,
        [WS_METHODS.testingDeleteTestSuite]: ({ projectId, suiteId }) =>
          observeRpcEffect(
            WS_METHODS.testingDeleteTestSuite,
            Effect.gen(function* () {
              const orchestrator = yield* TestOrchestrator;
              yield* orchestrator.deleteTestSuite({ projectId, suiteId });
              return { success: true as const };
            }),
            { "rpc.aggregate": "testing" },
          ) as any,
        [WS_METHODS.testingGenerateTests]: (request) =>
          observeRpcEffect(
            WS_METHODS.testingGenerateTests,
            Effect.gen(function* () {
              const orchestrator = yield* TestOrchestrator;
              const result = yield* orchestrator.generateTests(request);
              return { result };
            }),
            { "rpc.aggregate": "testing" },
          ) as any,
        [WS_METHODS.testingSelectRegressionTests]: ({ changedFiles, workspaceRoot }) =>
          observeRpcEffect(
            WS_METHODS.testingSelectRegressionTests,
            Effect.gen(function* () {
              const orchestrator = yield* TestOrchestrator;
              return yield* orchestrator.selectRegressionTests(
                [...changedFiles],
                workspaceRoot !== undefined ? workspaceRoot : undefined,
              );
            }),
            { "rpc.aggregate": "testing" },
          ) as any,
        [WS_METHODS.testingRunTests]: (config) =>
          observeRpcEffect(
            WS_METHODS.testingRunTests,
            Effect.gen(function* () {
              const orchestrator = yield* TestOrchestrator;
              return yield* orchestrator.runTests({
                ...config,
                testFiles: [...config.testFiles],
              });
            }),
            { "rpc.aggregate": "testing" },
          ) as any,
        [WS_METHODS.testingGetCoverageReport]: (payload) =>
          observeRpcEffect(
            WS_METHODS.testingGetCoverageReport,
            Effect.gen(function* () {
              const orchestrator = yield* TestOrchestrator;
              const { projectId, workspaceRoot, linesCoverageMinPercent, weakAreaMaxLinesPercent } =
                payload as {
                  projectId: string;
                  workspaceRoot?: string;
                  linesCoverageMinPercent?: number;
                  weakAreaMaxLinesPercent?: number;
                };
              const covOpts =
                linesCoverageMinPercent === undefined && weakAreaMaxLinesPercent === undefined
                  ? undefined
                  : {
                      ...(linesCoverageMinPercent !== undefined ? { linesCoverageMinPercent } : {}),
                      ...(weakAreaMaxLinesPercent !== undefined ? { weakAreaMaxLinesPercent } : {}),
                    };
              const report = yield* orchestrator.getCoverageReport(
                projectId,
                workspaceRoot !== undefined ? workspaceRoot : undefined,
                covOpts,
              );
              return report;
            }),
            { "rpc.aggregate": "testing" },
          ) as any,

        // Environment management methods
        [WS_METHODS.environmentList]: () =>
          observeRpcEffect(
            WS_METHODS.environmentList,
            Effect.gen(function* () {
              const manager = yield* EnvironmentManager;
              const profiles = yield* manager.listProfiles();
              return { environments: profiles };
            }),
            { "rpc.aggregate": "environment" },
          ) as any,
        [WS_METHODS.environmentGet]: ({ profileId }) =>
          observeRpcEffect(
            WS_METHODS.environmentGet,
            Effect.gen(function* () {
              const manager = yield* EnvironmentManager;
              return yield* manager.getProfile(profileId);
            }),
            { "rpc.aggregate": "environment" },
          ) as any,
        [WS_METHODS.environmentCreate]: (input) =>
          observeRpcEffect(
            WS_METHODS.environmentCreate,
            Effect.gen(function* () {
              const manager = yield* EnvironmentManager;
              const createParams =
                input.templateId !== undefined
                  ? { name: input.name, templateId: input.templateId }
                  : { name: input.name };
              return yield* manager.createProfile(createParams);
            }),
            { "rpc.aggregate": "environment" },
          ) as any,
        [WS_METHODS.environmentUpdate]: (input) =>
          observeRpcEffect(
            WS_METHODS.environmentUpdate,
            Effect.gen(function* () {
              const manager = yield* EnvironmentManager;
              return yield* manager.switchEnvironment({
                profileId: input.profileId,
                environmentId: input.activeEnvironmentId,
              });
            }),
            { "rpc.aggregate": "environment" },
          ) as any,
        [WS_METHODS.environmentDelete]: ({ profileId }) =>
          observeRpcEffect(
            WS_METHODS.environmentDelete,
            Effect.gen(function* () {
              const manager = yield* EnvironmentManager;
              yield* manager.deleteProfile(profileId);
              return { success: true };
            }),
            { "rpc.aggregate": "environment" },
          ) as any,
        [WS_METHODS.environmentExport]: (request) =>
          observeRpcEffect(
            WS_METHODS.environmentExport,
            Effect.gen(function* () {
              const manager = yield* EnvironmentManager;
              return yield* manager.exportEnvironment(request);
            }),
            { "rpc.aggregate": "environment" },
          ) as any,
        [WS_METHODS.environmentImport]: (request) =>
          observeRpcEffect(
            WS_METHODS.environmentImport,
            Effect.gen(function* () {
              const manager = yield* EnvironmentManager;
              return yield* manager.importEnvironment(request);
            }),
            { "rpc.aggregate": "environment" },
          ) as any,
        [WS_METHODS.environmentRefreshDependencyInsights]: ({ workspaceRoot }) =>
          observeRpcEffect(
            WS_METHODS.environmentRefreshDependencyInsights,
            Effect.gen(function* () {
              const manager = yield* EnvironmentManager;
              const tree = yield* manager.analyzeDependencies(workspaceRoot);
              const suggestions = yield* manager.getUpdateSuggestions(workspaceRoot);
              const auditFindings = runDependencyAuditInWorkspace(workspaceRoot);
              return { tree, suggestions, auditFindings };
            }),
            { "rpc.aggregate": "environment" },
          ) as any,

        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            workspaceEntries.search(input).pipe(
              Effect.mapError(
                (cause) =>
                  new ProjectSearchEntriesError({
                    message: `Failed to search workspace entries: ${cause.detail}`,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            workspaceFileSystem.writeFile(input).pipe(
              Effect.mapError((cause) => {
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Workspace file path must stay within the project root."
                  : "Failed to write workspace file";
                return new ProjectWriteFileError({
                  message,
                  cause,
                });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsReadFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsReadFile,
            workspaceFileSystem.readFile(input).pipe(
              Effect.map((contents) => ({ contents })),
              Effect.mapError((cause) => {
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "File path must stay within the project root."
                  : "Failed to read workspace file";
                return new ProjectReadFileError({ message, cause });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsListDirectory]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsListDirectory,
            workspaceFileSystem.listDirectory(input).pipe(
              Effect.map((entries) => ({
                entries: entries.map((e) => ({
                  name: e.name,
                  fullPath: e.path,
                  type: e.type,
                })),
              })),
              Effect.mapError((cause) => {
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "Directory path must stay within the project root."
                  : "Failed to list workspace directory";
                return new ProjectListDirectoryError({ message, cause });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsFileStat]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsFileStat,
            workspaceFileSystem.stat(input).pipe(
              Effect.map((stat) => ({
                size: stat.size,
                isDirectory: stat.isDirectory,
                isFile: !stat.isDirectory,
                isSymlink: false,
              })),
              Effect.mapError((cause) => {
                const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                  ? "File path must stay within the project root."
                  : "Failed to stat workspace file";
                return new ProjectFileStatError({ message, cause });
              }),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsCreateDirectory]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsCreateDirectory,
            workspaceFileSystem.createDirectory(input).pipe(Effect.catch(() => Effect.void)),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsDeleteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsDeleteFile,
            workspaceFileSystem
              .deleteFile({
                cwd: input.cwd,
                relativePath: input.relativePath,
                ...(input.recursive !== undefined ? { recursive: input.recursive } : {}),
              })
              .pipe(Effect.catch(() => Effect.void)),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsRenameFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsRenameFile,
            workspaceFileSystem.renameFile(input).pipe(
              Effect.map((relativePath) => ({ relativePath })),
              Effect.catch(() => Effect.succeed({ relativePath: input.toPath })),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
            "rpc.aggregate": "workspace",
          }),
        [WS_METHODS.filesystemBrowse]: (input) =>
          observeRpcEffect(
            WS_METHODS.filesystemBrowse,
            workspaceEntries.browse(input).pipe(
              Effect.mapError(
                (cause) =>
                  new FilesystemBrowseError({
                    message: cause.detail,
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.sshListConnections]: () =>
          observeRpcEffect(WS_METHODS.sshListConnections, listSshConnections, {
            "rpc.aggregate": "ssh",
          }),
        [WS_METHODS.sshListDirectory]: (input) =>
          observeRpcEffect(WS_METHODS.sshListDirectory, listSshDirectory(input), {
            "rpc.aggregate": "ssh",
          }),
        [WS_METHODS.sshUpsertConnection]: (input) =>
          observeRpcEffect(WS_METHODS.sshUpsertConnection, upsertSshConnection(input), {
            "rpc.aggregate": "ssh",
          }),
        [WS_METHODS.sshDeleteConnection]: (input) =>
          observeRpcEffect(WS_METHODS.sshDeleteConnection, deleteSshConnection(input), {
            "rpc.aggregate": "ssh",
          }),
        [WS_METHODS.sshTestConnection]: (input) =>
          observeRpcEffect(WS_METHODS.sshTestConnection, testSshConnection(input), {
            "rpc.aggregate": "ssh",
          }),
        [WS_METHODS.sshConfirmHostKey]: (input) =>
          observeRpcEffect(WS_METHODS.sshConfirmHostKey, confirmSshHostKey(input), {
            "rpc.aggregate": "ssh",
          }),
        [WS_METHODS.sshListProviderProbes]: (input) =>
          observeRpcEffect(WS_METHODS.sshListProviderProbes, listSshProviderProbes(input), {
            "rpc.aggregate": "ssh",
          }),
        [WS_METHODS.serverGetConnectionProviders]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverGetConnectionProviders,
            getConnectionProviders(input).pipe(Effect.orDie),
            {
              "rpc.aggregate": "ssh",
            },
          ),
        [WS_METHODS.subscribeGitStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeGitStatus,
            gitStatusBroadcaster.streamStatus(input),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRefreshStatus,
            gitStatusBroadcaster.refreshStatus(input.cwd),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPull,
            git.pullCurrentBranch(input.cwd).pipe(
              Effect.matchCauseEffect({
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: (result) =>
                  refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
              }),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
              gitManager
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: () =>
                      refreshGitStatus(input.cwd).pipe(
                        Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                      ),
                  }),
                ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            gitManager
              .preparePullRequestThread(input)
              .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitListBranches]: (input) =>
          observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), {
            "rpc.aggregate": "git",
          }),
        [WS_METHODS.gitCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateWorktree,
            git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRemoveWorktree,
            git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCreateBranch]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateBranch,
            git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCheckout]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCheckout,
            Effect.scoped(git.checkoutBranch(input)).pipe(
              Effect.tap(() => refreshGitStatus(input.cwd)),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitInit,
            git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
            "rpc.aggregate": "terminal",
          }),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            Stream.callback<TerminalEvent>((queue) =>
              Effect.acquireRelease(
                terminalManager.subscribe((event) => Queue.offer(queue, event)),
                (unsubscribe) => Effect.sync(unsubscribe),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = providerRegistry.streamChanges.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
                Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
              );
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              yield* Effect.all(
                [providerRegistry.refresh("codex"), providerRegistry.refresh("claudeAgent")],
                {
                  concurrency: "unbounded",
                  discard: true,
                },
              ).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

              const liveUpdates = Stream.merge(
                keybindingsUpdates,
                Stream.merge(providerStatuses, settingsUpdates),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config: yield* loadServerConfig,
                }),
                liveUpdates,
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeAuthAccess,
            Effect.gen(function* () {
              const initialSnapshot = yield* loadAuthAccessSnapshot();
              const revisionRef = yield* Ref.make(1);
              const accessChanges: Stream.Stream<
                BootstrapCredentialChange | SessionCredentialChange
              > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

              const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                Stream.mapEffect((change) =>
                  Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                    Effect.map((revision) =>
                      toAuthAccessStreamEvent(change, revision, currentSessionId),
                    ),
                  ),
                ),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  revision: 1,
                  type: "snapshot" as const,
                  payload: initialSnapshot,
                }),
                liveEvents,
              );
            }),
            { "rpc.aggregate": "auth" },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const wsTraceId = crypto.randomUUID();
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session.sessionId, wsTraceId).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions
            .markConnected(session.sessionId)
            .pipe(
              Effect.tap(() =>
                Effect.logInfo(
                  `【中断重连】WebSocket 传输层已接通（含首次连接与断线后的重连）。sessionId=${String(session.sessionId)} wsTraceId=${wsTraceId}。后续客户端应发起 subscribeShell、subscribeThread 等订阅；若仅 TCP 恢复而未重建订阅，界面可能不会同步最新回合与消息。`,
                ),
              ),
            ),
          () => rpcWebSocketHttpEffect,
          () =>
            sessions
              .markDisconnected(session.sessionId)
              .pipe(
                Effect.tap(() =>
                  Effect.logInfo(
                    `【中断重连】WebSocket 传输层已断开。sessionId=${String(session.sessionId)} wsTraceId=${wsTraceId}。服务端编排与线程数据仍保留；客户端重连后需重新订阅流或调用 replayEvents 补拉缺失事件，否则 UI 可能仍显示断线前的状态。`,
                  ),
                ),
              ),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
