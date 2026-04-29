import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ModelSelection,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Path,
  Queue,
  Ref,
  Scope,
  Context,
  Console,
} from "effect";

import { ServerConfig } from "./config.ts";
import { Keybindings } from "./keybindings.ts";
import { Open } from "./open.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { reconcileStartupStaleRunningSessions } from "./provider/reconcileStartupStaleRunningSessions.ts";
import { ProviderSessionReaper } from "./provider/Services/ProviderSessionReaper.ts";
import {
  formatHeadlessServeOutput,
  formatHostForUrl,
  isWildcardHost,
  issueHeadlessServeAccessInfo,
} from "./startupAccess.ts";

export class ServerRuntimeStartupError extends Data.TaggedError("ServerRuntimeStartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ServerRuntimeStartupShape {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly markHttpListening: Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

export class ServerRuntimeStartup extends Context.Service<
  ServerRuntimeStartup,
  ServerRuntimeStartupShape
>()("t3/serverRuntimeStartup") {}

interface QueuedCommand {
  readonly run: Effect.Effect<void, never>;
}

type CommandReadinessState = "pending" | "ready" | ServerRuntimeStartupError;

interface CommandGate {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly signalCommandReady: Effect.Effect<void>;
  readonly failCommandReady: (error: ServerRuntimeStartupError) => Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

const settleQueuedCommand = <A, E>(deferred: Deferred.Deferred<A, E>, exit: Exit.Exit<A, E>) =>
  Exit.isSuccess(exit)
    ? Deferred.succeed(deferred, exit.value)
    : Deferred.failCause(deferred, exit.cause);

export const makeCommandGate = Effect.gen(function* () {
  const commandReady = yield* Deferred.make<void, ServerRuntimeStartupError>();
  const commandQueue = yield* Queue.unbounded<QueuedCommand>();
  const commandReadinessState = yield* Ref.make<CommandReadinessState>("pending");

  const commandWorker = Effect.forever(
    Queue.take(commandQueue).pipe(Effect.flatMap((command) => command.run)),
  );
  yield* Effect.forkScoped(commandWorker);

  return {
    awaitCommandReady: Deferred.await(commandReady),
    signalCommandReady: Effect.gen(function* () {
      yield* Ref.set(commandReadinessState, "ready");
      yield* Deferred.succeed(commandReady, undefined).pipe(Effect.orDie);
    }),
    failCommandReady: (error) =>
      Effect.gen(function* () {
        yield* Ref.set(commandReadinessState, error);
        yield* Deferred.fail(commandReady, error).pipe(Effect.orDie);
      }),
    enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const readinessState = yield* Ref.get(commandReadinessState);
        if (readinessState === "ready") {
          return yield* effect;
        }
        if (readinessState !== "pending") {
          return yield* readinessState;
        }

        const result = yield* Deferred.make<A, E | ServerRuntimeStartupError>();
        yield* Queue.offer(commandQueue, {
          run: Deferred.await(commandReady).pipe(
            Effect.flatMap(() => effect),
            Effect.exit,
            Effect.flatMap((exit) => settleQueuedCommand(result, exit)),
          ),
        });
        return yield* Deferred.await(result);
      }),
  } satisfies CommandGate;
});

export const recordStartupHeartbeat = Effect.gen(function* () {
  const analytics = yield* AnalyticsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const { threadCount, projectCount } = yield* projectionSnapshotQuery.getCounts().pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to gather startup projection counts for telemetry", {
        cause,
      }).pipe(
        Effect.as({
          threadCount: 0,
          projectCount: 0,
        }),
      ),
    ),
  );

  yield* analytics.record("server.boot.heartbeat", {
    threadCount,
    projectCount,
  });
});

export const launchStartupHeartbeat = recordStartupHeartbeat.pipe(
  Effect.annotateSpans({ "startup.phase": "heartbeat.record" }),
  Effect.withSpan("server.startup.heartbeat.record"),
  Effect.ignoreCause({ log: true }),
  Effect.forkScoped,
  Effect.asVoid,
);

export const getAutoBootstrapDefaultModelSelection = (): ModelSelection => ({
  provider: "codex",
  model: DEFAULT_MODEL_BY_PROVIDER.codex,
});

export const resolveWelcomeBase = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
  const projectName = segments[segments.length - 1] ?? "project";

  return {
    cwd: serverConfig.cwd,
    projectName,
  } as const;
});

export const resolveAutoBootstrapWelcomeTargets = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const path = yield* Path.Path;

  let bootstrapProjectId: ProjectId | undefined;
  let bootstrapThreadId: ThreadId | undefined;

  if (serverConfig.autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const existingProject = yield* projectionReadModelQuery.getActiveProjectByWorkspaceRoot(
        serverConfig.cwd,
      );
      let nextProjectId: ProjectId;
      let nextProjectDefaultModelSelection: ModelSelection;

      if (Option.isNone(existingProject)) {
        const createdAt = new Date().toISOString();
        nextProjectId = ProjectId.make(crypto.randomUUID());
        const bootstrapProjectTitle = path.basename(serverConfig.cwd) || "project";
        nextProjectDefaultModelSelection = getAutoBootstrapDefaultModelSelection();
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(crypto.randomUUID()),
          projectId: nextProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: serverConfig.cwd,
          defaultModelSelection: nextProjectDefaultModelSelection,
          createdAt,
        });
      } else {
        nextProjectId = existingProject.value.id;
        nextProjectDefaultModelSelection =
          existingProject.value.defaultModelSelection ?? getAutoBootstrapDefaultModelSelection();
      }

      const existingThreadId =
        yield* projectionReadModelQuery.getFirstActiveThreadIdByProjectId(nextProjectId);
      if (Option.isNone(existingThreadId)) {
        const createdAt = new Date().toISOString();
        const createdThreadId = ThreadId.make(crypto.randomUUID());
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(crypto.randomUUID()),
          threadId: createdThreadId,
          projectId: nextProjectId,
          title: "新项目",
          modelSelection: nextProjectDefaultModelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        bootstrapProjectId = nextProjectId;
        bootstrapThreadId = createdThreadId;
      } else {
        bootstrapProjectId = nextProjectId;
        bootstrapThreadId = existingThreadId.value;
      }
    });
  }

  return {
    ...(bootstrapProjectId ? { bootstrapProjectId } : {}),
    ...(bootstrapThreadId ? { bootstrapThreadId } : {}),
  } as const;
});

const resolveStartupBrowserTarget = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const serverAuth = yield* ServerAuth;
  const localUrl = `http://localhost:${serverConfig.port}`;
  const bindUrl =
    serverConfig.host && !isWildcardHost(serverConfig.host)
      ? `http://${formatHostForUrl(serverConfig.host)}:${serverConfig.port}`
      : localUrl;
  const baseTarget = serverConfig.devUrl?.toString() ?? bindUrl;
  return yield* Effect.succeed(serverConfig.mode === "desktop" ? baseTarget : undefined).pipe(
    Effect.flatMap((target) =>
      target ? Effect.succeed(target) : serverAuth.issueStartupPairingUrl(baseTarget),
    ),
  );
});

const maybeOpenBrowser = (target: string) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    if (serverConfig.noBrowser) {
      return;
    }
    const { openBrowser } = yield* Open;

    yield* openBrowser(target).pipe(
      Effect.catch(() =>
        Effect.logInfo("浏览器自动打开不可用", {
          hint: `在浏览器中打开 ${target}。`,
        }),
      ),
    );
  });

const runStartupPhase = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateSpans({ "startup.phase": phase }),
    Effect.withSpan(`server.startup.${phase}`),
  );

export const makeServerRuntimeStartup = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const keybindings = yield* Keybindings;
  const orchestrationReactor = yield* OrchestrationReactor;
  const providerSessionReaper = yield* ProviderSessionReaper;
  const lifecycleEvents = yield* ServerLifecycleEvents;
  const serverSettings = yield* ServerSettingsService;
  const serverEnvironment = yield* ServerEnvironment;

  const commandGate = yield* makeCommandGate;
  const httpListening = yield* Deferred.make<void>();
  const reactorScope = yield* Scope.make("sequential");

  yield* Effect.addFinalizer(() => Scope.close(reactorScope, Exit.void));

  const startup = Effect.gen(function* () {
    yield* Effect.logDebug("启动阶段: 启动键绑定运行时");
    yield* runStartupPhase(
      "keybindings.start",
      keybindings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("启动键绑定运行时失败", {
            path: error.configPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* Effect.logDebug("启动阶段: 启动服务器设置运行时");
    yield* runStartupPhase(
      "settings.start",
      serverSettings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("启动服务器设置运行时失败", {
            path: error.settingsPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* Effect.logDebug("启动阶段: 启动编排反应器");
    yield* runStartupPhase(
      "reactors.start",
      orchestrationReactor
        .start()
        .pipe(
          Scope.provide(reactorScope),
          Effect.andThen(providerSessionReaper.start().pipe(Scope.provide(reactorScope))),
          Effect.andThen(reconcileStartupStaleRunningSessions),
        ),
    );

    const welcomeBase = yield* resolveWelcomeBase;
    const environment = yield* serverEnvironment.getDescriptor;
    yield* Effect.logDebug("启动阶段: 准备欢迎负载");
    yield* Effect.logDebug("启动阶段: 发布欢迎事件", {
      environmentId: environment.environmentId,
      cwd: welcomeBase.cwd,
      projectName: welcomeBase.projectName,
    });
    yield* runStartupPhase(
      "welcome.publish欢迎发布",
      lifecycleEvents.publish({
        version: 1,
        type: "welcome",
        payload: {
          environment,
          ...welcomeBase,
        },
      }),
    );

    if (serverConfig.autoBootstrapProjectFromCwd) {
      yield* Effect.forkScoped(
        runStartupPhase(
          "welcome.autobootstrap",
          Effect.gen(function* () {
            const bootstrapTargets = yield* resolveAutoBootstrapWelcomeTargets;
            if (!bootstrapTargets.bootstrapProjectId && !bootstrapTargets.bootstrapThreadId) {
              return;
            }

            yield* Effect.logDebug("启动阶段: 发布引导欢迎事件", {
              environmentId: environment.environmentId,
              cwd: welcomeBase.cwd,
              projectName: welcomeBase.projectName,
              bootstrapProjectId: bootstrapTargets.bootstrapProjectId,
              bootstrapThreadId: bootstrapTargets.bootstrapThreadId,
            });
            yield* lifecycleEvents.publish({
              version: 1,
              type: "welcome",
              payload: {
                environment,
                ...welcomeBase,
                ...bootstrapTargets,
              },
            });
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("启动自动引导欢迎失败", {
                cause,
              }),
            ),
          ),
        ),
      );
    }
  }).pipe(
    Effect.annotateSpans({
      "server.mode": serverConfig.mode,
      "server.port": serverConfig.port,
      "server.host": serverConfig.host ?? "default",
    }),
    Effect.withSpan("server.startup", { kind: "server", root: true }),
  );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const startupExit = yield* Effect.exit(startup);
      if (Exit.isFailure(startupExit)) {
        const error = new ServerRuntimeStartupError({
          message: "服务器运行时启动失败，命令准备就绪前。",
          cause: startupExit.cause,
        });
        yield* Effect.logError("服务器运行时启动失败", { cause: startupExit.cause });
        yield* commandGate.failCommandReady(error);
        return;
      }

      yield* Effect.logDebug("接受命令");
      yield* commandGate.signalCommandReady;
      yield* Effect.logDebug("启动阶段: 等待 HTTP 监听器");
      yield* runStartupPhase("http.wait", Deferred.await(httpListening));
      yield* Effect.logDebug("启动阶段: 发布就绪事件");
      yield* runStartupPhase(
        "ready.publish就绪发布",
        lifecycleEvents.publish({
          version: 1,
          type: "ready",
          payload: {
            at: new Date().toISOString(),
            environment: yield* serverEnvironment.getDescriptor,
          },
        }),
      );

      yield* Effect.logDebug("启动阶段: 记录启动心跳");
      yield* launchStartupHeartbeat;
      if (serverConfig.startupPresentation === "headless") {
        yield* Effect.logDebug("启动阶段: 无头访问信息");
        const accessInfo = yield* issueHeadlessServeAccessInfo();
        yield* runStartupPhase(
          "headless.output",
          Console.log(formatHeadlessServeOutput(accessInfo)),
        );
      } else {
        yield* Effect.logDebug("启动阶段: 浏览器打开检查");
        const startupBrowserTarget = yield* resolveStartupBrowserTarget;
        if (serverConfig.mode !== "desktop") {
          yield* Effect.logInfo("认证要求。使用配对 URL 打开 T3 Code。").pipe(
            Effect.annotateLogs({ pairingUrl: startupBrowserTarget }),
          );
        }
        yield* runStartupPhase("browser.open浏览器打开", maybeOpenBrowser(startupBrowserTarget));
      }
      yield* Effect.logDebug("启动阶段: 完成");
    }),
  );

  return {
    awaitCommandReady: commandGate.awaitCommandReady,
    markHttpListening: Deferred.succeed(httpListening, undefined),
    enqueueCommand: commandGate.enqueueCommand,
  } satisfies ServerRuntimeStartupShape;
});

export const ServerRuntimeStartupLive = Layer.effect(
  ServerRuntimeStartup,
  makeServerRuntimeStartup,
);
