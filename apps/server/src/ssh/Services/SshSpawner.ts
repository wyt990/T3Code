import { PassThrough, type Readable, type Writable } from "node:stream";

import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { Effect, Stream } from "effect";

import type {
  WorkspaceExecution,
  WorkspaceInteractiveProcess,
} from "../../workspace/Services/WorkspaceExecution.ts";
import { formatSshUserMessage } from "../formatSshUserMessage.ts";

/**
 * Adapts a workspace interactive process (local or SSH) to the Claude Agent SDK
 * {@link SpawnedProcess} interface.
 */
export const workspaceInteractiveToSpawnedProcess = (
  process: WorkspaceInteractiveProcess,
): SpawnedProcess => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();

  stdin.on("data", (chunk: Buffer | string) => {
    void Effect.runPromise(process.write(chunk).pipe(Effect.catch(() => Effect.void)));
  });

  void Effect.runPromise(
    Stream.runForEach(process.stdout, (chunk) =>
      Effect.sync(() => {
        stdout.push(chunk);
      }),
    ).pipe(
      Effect.catch(() => Effect.void),
      Effect.ensuring(
        Effect.sync(() => {
          stdout.push(null);
        }),
      ),
    ),
  );

  let killed = false;
  let exitCode: number | null = null;
  const exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  const errorListeners = new Set<(error: Error) => void>();

  void Effect.runPromise(
    process.exited.pipe(
      Effect.tap((code) =>
        Effect.sync(() => {
          exitCode = code;
          killed = true;
          for (const listener of exitListeners) {
            listener(code, null);
          }
          stdout.push(null);
        }),
      ),
      Effect.catch(() => Effect.void),
    ),
  );

  const spawned: SpawnedProcess = {
    stdin: stdin as Writable,
    stdout: stdout as Readable,
    get killed() {
      return killed;
    },
    get exitCode() {
      return exitCode;
    },
    kill: () => {
      killed = true;
      void Effect.runPromise(process.kill().pipe(Effect.catch(() => Effect.void)));
      return true;
    },
    on: (event, listener) => {
      if (event === "exit") {
        exitListeners.add(listener as (code: number | null, signal: NodeJS.Signals | null) => void);
      } else if (event === "error") {
        errorListeners.add(listener as (error: Error) => void);
      }
    },
    once: (event, listener) => {
      const wrapped =
        event === "exit"
          ? (code: number | null, signal: NodeJS.Signals | null) => {
              exitListeners.delete(
                wrapped as (code: number | null, signal: NodeJS.Signals | null) => void,
              );
              (listener as (code: number | null, signal: NodeJS.Signals | null) => void)(
                code,
                signal,
              );
            }
          : (error: Error) => {
              errorListeners.delete(wrapped as (error: Error) => void);
              (listener as (error: Error) => void)(error);
            };
      if (event === "exit") {
        exitListeners.add(wrapped as (code: number | null, signal: NodeJS.Signals | null) => void);
      } else {
        errorListeners.add(wrapped as (error: Error) => void);
      }
    },
    off: (event, listener) => {
      if (event === "exit") {
        exitListeners.delete(
          listener as (code: number | null, signal: NodeJS.Signals | null) => void,
        );
      } else {
        errorListeners.delete(listener as (error: Error) => void);
      }
    },
  };

  return spawned;
};

const toSpawnError = (cause: unknown): Error => {
  const message = formatSshUserMessage(cause);
  const error = new Error(message);
  if (cause instanceof Error) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
};

/**
 * Claude Agent SDK requires `spawnClaudeCodeProcess` to return synchronously.
 * SSH `spawnInteractive` is async (opens a channel), so we bootstrap in the background
 * and bridge streams once the remote process is ready.
 */
export const spawnClaudeCodeProcessOverSsh = (
  execution: WorkspaceExecution,
  remoteEnv: Record<string, string>,
  spawnOptions: SpawnOptions,
): SpawnedProcess => {
  const stdinBridge = new PassThrough();
  const stdoutBridge = new PassThrough();
  const stdinPending: Array<Buffer | string> = [];
  let delegate: SpawnedProcess | null = null;
  let bootstrapError: Error | null = null;
  let killed = false;
  let exitCode: number | null = null;
  const exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  const errorListeners = new Set<(error: Error) => void>();

  const emitError = (error: Error) => {
    bootstrapError = error;
    killed = true;
    for (const listener of errorListeners) {
      listener(error);
    }
    stdoutBridge.push(null);
  };

  const wireDelegate = (interactive: WorkspaceInteractiveProcess) => {
    const spawned = workspaceInteractiveToSpawnedProcess(interactive);
    delegate = spawned;
    spawned.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBridge.push(chunk);
    });
    spawned.stdout.on("end", () => {
      stdoutBridge.push(null);
    });
    spawned.stdout.on("error", (error: Error) => {
      stdoutBridge.destroy(error);
    });
    for (const chunk of stdinPending) {
      spawned.stdin.write(chunk);
    }
    stdinPending.length = 0;
    spawned.on("exit", (code, signal) => {
      exitCode = code;
      killed = true;
      for (const listener of exitListeners) {
        listener(code, signal);
      }
    });
    spawned.on("error", (error: Error) => {
      emitError(error);
    });
  };

  stdinBridge.on("data", (chunk: Buffer | string) => {
    if (delegate) {
      delegate.stdin.write(chunk);
      return;
    }
    if (bootstrapError !== null) {
      return;
    }
    stdinPending.push(chunk);
  });

  void Effect.runPromise(
    execution
      .spawnInteractive({
        command: spawnOptions.command,
        args: spawnOptions.args,
        cwd: spawnOptions.cwd ?? execution.workspaceRoot,
        env: remoteEnv,
        signal: spawnOptions.signal,
      })
      .pipe(
        Effect.map(wireDelegate),
        Effect.catch((cause) =>
          Effect.sync(() => {
            emitError(toSpawnError(cause));
          }),
        ),
      ),
  );

  return {
    stdin: stdinBridge as Writable,
    stdout: stdoutBridge as Readable,
    get killed() {
      return killed || (delegate?.killed ?? false);
    },
    get exitCode() {
      return exitCode ?? delegate?.exitCode ?? null;
    },
    kill: () => {
      killed = true;
      if (delegate) {
        return delegate.kill();
      }
      if (spawnOptions.signal && !spawnOptions.signal.aborted) {
        spawnOptions.signal.dispatchEvent(new Event("abort"));
      }
      return true;
    },
    on: (event, listener) => {
      if (bootstrapError !== null && event === "error") {
        (listener as (error: Error) => void)(bootstrapError);
      }
      if (event === "exit") {
        exitListeners.add(listener as (code: number | null, signal: NodeJS.Signals | null) => void);
      } else {
        errorListeners.add(listener as (error: Error) => void);
      }
      delegate?.on(event, listener);
    },
    once: (event, listener) => {
      if (bootstrapError !== null && event === "error") {
        (listener as (error: Error) => void)(bootstrapError);
        return;
      }
      delegate?.once(event, listener);
    },
    off: (event, listener) => {
      if (event === "exit") {
        exitListeners.delete(
          listener as (code: number | null, signal: NodeJS.Signals | null) => void,
        );
      } else {
        errorListeners.delete(listener as (error: Error) => void);
      }
      delegate?.off(event, listener);
    },
  };
};
