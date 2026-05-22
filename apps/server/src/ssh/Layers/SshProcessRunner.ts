import type { ClientChannel } from "ssh2";
import { Duration, Effect, Layer, Option, Queue, Stream } from "effect";

import { SshCommandError, SshConnectionError } from "../Errors.ts";
import { formatSshUserMessage } from "../formatSshUserMessage.ts";
import { SSH_EXEC_TIMEOUT_MS } from "../sshConnectDefaults.ts";
import { attachSshChannelLifecycle } from "../sshChannelLifecycle.ts";
import {
  buildRemoteCdPrefix,
  buildRemoteCommand,
  collectChannelOutput,
  shellQuotePosix,
} from "../ssh2Adapter.ts";
import { SshConnectionPool } from "../Services/SshConnectionPool.ts";
import { SshProcessRunner } from "../Services/SshProcessRunner.ts";
import { DEFAULT_SSH_CONNECTION_LANE, type SshConnectionLane } from "../sshConnectionLane.ts";
import { sharedSshLaneConcurrency } from "../sshLaneConcurrency.ts";
import {
  WorkspaceExecutionError,
  type WorkspaceInteractiveProcess,
} from "../../workspace/Services/WorkspaceExecution.ts";

// 包装命令以加载 shell 环境。git lane 用非交互式 bash，避免 .bashrc 污染 stdout（commit-tree oid 解析）。
const wrapCommandWithShell = (
  command: string,
  cwd?: string,
  options?: { readonly interactive?: boolean },
): string => {
  const fullCommand = `${buildRemoteCdPrefix(cwd)}${command}`;
  if (options?.interactive === false) {
    return `bash -lc ${shellQuotePosix(fullCommand)}`;
  }
  return `bash -ilc ${shellQuotePosix(`source ~/.bashrc 2>/dev/null; source ~/.profile 2>/dev/null; ${fullCommand}`)}`;
};

const toCommandError = (input: {
  readonly connectionId: string;
  readonly command: string;
  readonly detail: string;
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly cause?: unknown;
}) =>
  new SshCommandError({
    connectionId: input.connectionId,
    command: input.command,
    exitCode: input.exitCode,
    stderr: input.stderr,
    detail: input.detail,
    cause: input.cause,
  });

const envRecord = (env: Record<string, string | undefined> | undefined) => {
  if (env === undefined) {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
};

const makeInteractiveProcess = (input: {
  readonly connectionId: string;
  readonly command: string;
  readonly channel: ClientChannel;
  readonly signal?: AbortSignal;
  readonly releaseLease: () => Effect.Effect<void>;
}): WorkspaceInteractiveProcess => {
  const outputQueue = Effect.runSync(Queue.unbounded<string, never>());
  const stderrQueue = Effect.runSync(Queue.unbounded<string, never>());
  const exitQueue = Effect.runSync(Queue.unbounded<number, never>());

  let closed = false;

  const onAbort = () => {
    if (!closed) {
      input.channel.close();
    }
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  input.channel.on("data", (chunk: Buffer) => {
    void Effect.runPromise(Queue.offer(outputQueue, chunk.toString("utf8")));
  });
  input.channel.stderr?.on("data", (chunk: Buffer) => {
    void Effect.runPromise(Queue.offer(stderrQueue, chunk.toString("utf8")));
  });
  const { closeChannel, offerExit } = attachSshChannelLifecycle({
    channel: input.channel,
    exitQueue,
    releaseLease: input.releaseLease,
  });

  input.channel.on("close", () => {
    closed = true;
    input.signal?.removeEventListener("abort", onAbort);
  });
  input.channel.on("error", (error: unknown) => {
    void offerExit(1).pipe(Effect.runPromise);
    void Effect.runPromise(
      Queue.offer(outputQueue, error instanceof Error ? error.message : String(error)),
    );
  });

  return {
    write: (data) =>
      Effect.sync(() => {
        if (closed) {
          return;
        }
        input.channel.write(typeof data === "string" ? data : Buffer.from(data));
      }),
    stdout: Stream.fromQueue(outputQueue),
    stderr: Stream.fromQueue(stderrQueue),
    exited: Queue.take(exitQueue).pipe(
      Effect.mapError(
        () =>
          new WorkspaceExecutionError({
            kind: "ssh",
            operation: "spawnInteractive.exited",
            detail: "Interactive SSH process exited without a code.",
          }),
      ),
    ),
    kill: () =>
      Effect.gen(function* () {
        closed = true;
        input.signal?.removeEventListener("abort", onAbort);
        yield* closeChannel();
      }),
  };
};

export const makeSshProcessRunner = Effect.gen(function* () {
  const pool = yield* SshConnectionPool;
  const laneConcurrency = yield* sharedSshLaneConcurrency();

  const resolveExecLane = (lane: SshConnectionLane | undefined): SshConnectionLane =>
    lane ?? DEFAULT_SSH_CONNECTION_LANE;

  const runExec = Effect.fn("SshProcessRunner.runExec")(function* (input: {
    readonly connectionId: string;
    readonly lane: SshConnectionLane;
    readonly command: string;
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
    readonly stdin?: string;
  }) {
    const lease = yield* pool.acquire(input.connectionId, { lane: input.lane });

    const wrappedCommand = wrapCommandWithShell(input.command, input.cwd, {
      interactive: input.lane !== "git",
    });

    const result = yield* Effect.tryPromise({
      try: () =>
        new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
          const execOptions = envRecord(input.env);
          lease.client.exec(
            wrappedCommand,
            execOptions === undefined ? {} : { env: execOptions },
            (error, channel) => {
              if (error !== undefined) {
                reject(error);
                return;
              }
              if (input.stdin !== undefined) {
                channel.write(input.stdin);
              }
              channel.end();
              collectChannelOutput(channel).then(resolve, reject);
            },
          );
        }),
      catch: (cause) => {
        const errorDetail = cause instanceof Error ? cause.message : String(cause);
        const errorStack = cause instanceof Error ? cause.stack : undefined;
        const errorCode = (cause as { code?: string }).code;
        return toCommandError({
          connectionId: input.connectionId,
          command: input.command,
          detail: `${formatSshUserMessage(cause)} (code: ${errorCode ?? "unknown"})`,
          cause: new Error(`SSH exec failed: ${errorDetail}\nStack: ${errorStack ?? "N/A"}`),
        });
      },
    }).pipe(
      Effect.timeoutOption(Duration.millis(SSH_EXEC_TIMEOUT_MS)),
      Effect.flatMap((option) =>
        Option.match(option, {
          onNone: () =>
            Effect.fail(
              toCommandError({
                connectionId: input.connectionId,
                command: input.command,
                detail: "远程命令执行超时，请稍后重试或检查远程主机负载。",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
      Effect.ensuring(lease.release()),
      Effect.mapError((error: SshCommandError | SshConnectionError) =>
        error instanceof SshCommandError
          ? error
          : toCommandError({
              connectionId: input.connectionId,
              command: input.command,
              detail: error.message,
              cause: error,
            }),
      ),
    );

    if (result.exitCode !== 0) {
      yield* Effect.logInfo("[SshProcessRunner] exec failed", {
        connectionId: input.connectionId,
        exitCode: result.exitCode,
        stderrLength: result.stderr.length,
        stderr: result.stderr.slice(0, 500),
      });
    } else {
      yield* Effect.logInfo("[SshProcessRunner] exec completed", {
        connectionId: input.connectionId,
        exitCode: result.exitCode,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
      });
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  });

  const exec: (typeof SshProcessRunner)["Service"]["exec"] = Effect.fn("SshProcessRunner.exec")(
    function* (input) {
      const lane = resolveExecLane(input.lane);
      yield* Effect.logInfo("[SshProcessRunner] exec starting", {
        connectionId: input.connectionId,
        lane,
        command: input.command,
        cwd: input.cwd,
        hasEnv: input.env !== undefined,
        hasStdin: input.stdin !== undefined,
      });

      return yield* laneConcurrency.withLanePermit(
        input.connectionId,
        lane,
        runExec({
          connectionId: input.connectionId,
          lane,
          command: input.command,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          ...(input.env === undefined ? {} : { env: input.env }),
          ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        }),
      );
    },
  );

  // Removed all logging statements that used yield* outside of proper context
  // due to build errors
  const spawnInteractive: (typeof SshProcessRunner)["Service"]["spawnInteractive"] = Effect.fn(
    "SshProcessRunner.spawnInteractive",
  )(function* (input) {
    yield* Effect.logInfo("[SshProcessRunner] spawnInteractive starting", {
      connectionId: input.connectionId,
      command: input.command,
      cwd: input.cwd,
      args: input.args?.length ?? 0,
    });

    const lane = input.lane ?? "interactive";

    return yield* laneConcurrency.withLanePermit(
      input.connectionId,
      lane,
      spawnInteractiveOnLane({
        connectionId: input.connectionId,
        lane,
        command: input.command,
        cwd: input.cwd,
        args: input.args,
        env: input.env,
        signal: input.signal,
      }),
    );
  });

  const spawnInteractiveOnLane = Effect.fn("SshProcessRunner.spawnInteractiveOnLane")(
    function* (input: {
      readonly connectionId: string;
      readonly lane: SshConnectionLane;
      readonly command: string;
      readonly cwd?: string;
      readonly args?: ReadonlyArray<string>;
      readonly env?: Record<string, string | undefined>;
      readonly signal?: AbortSignal;
    }) {
      const lease = yield* pool.acquire(input.connectionId, {
        lane: input.lane,
      });

      const remoteCommand = buildRemoteCommand({
        cwd: input.cwd,
        command: input.command,
        args: input.args,
      });

      // 使用 bash -ilc 包装命令以确保加载完整的 shell 环境
      const wrappedCommand = wrapCommandWithShell(remoteCommand, input.cwd);

      const channel = yield* Effect.tryPromise({
        try: () =>
          new Promise<ClientChannel>((resolve, reject) => {
            const execOptions = envRecord(input.env);
            lease.client.exec(
              wrappedCommand,
              execOptions === undefined ? {} : { env: execOptions },
              (error, stream) => {
                if (error !== undefined) {
                  reject(error);
                  return;
                }
                resolve(stream);
              },
            );
          }),
        catch: (cause) => {
          const errorDetail = cause instanceof Error ? cause.message : String(cause);
          const errorStack = cause instanceof Error ? cause.stack : undefined;
          const errorCode = (cause as { code?: string }).code;
          return toCommandError({
            connectionId: input.connectionId,
            command: remoteCommand,
            detail: `${formatSshUserMessage(cause)} (code: ${errorCode ?? "unknown"})`,
            cause: new Error(
              `SSH spawnInteractive failed: ${errorDetail}\nStack: ${errorStack ?? "N/A"}`,
            ),
          });
        },
      }).pipe(
        Effect.tapError((error) =>
          Effect.logInfo("[SshProcessRunner] spawnInteractive failed, releasing lease", {
            connectionId: input.connectionId,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
        Effect.catch((error) => lease.release().pipe(Effect.flatMap(() => Effect.fail(error)))),
      );

      yield* Effect.logInfo("[SshProcessRunner] spawnInteractive channel opened", {
        connectionId: input.connectionId,
      });

      return makeInteractiveProcess({
        connectionId: input.connectionId,
        command: remoteCommand,
        channel,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        releaseLease: lease.release,
      });
    },
  );

  return { exec, spawnInteractive } satisfies (typeof SshProcessRunner)["Service"];
});

export const SshProcessRunnerLive = Layer.effect(SshProcessRunner, makeSshProcessRunner);
