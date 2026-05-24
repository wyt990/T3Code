import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { Effect, FileSystem, Path, Queue, Scope, Stream } from "effect";

import { runProcess } from "../../processRunner.ts";
import type { PtyAdapterShape } from "../../terminal/Services/PTY.ts";
import {
  WorkspaceExecutionError,
  type WorkspaceExecution,
  type WorkspaceSpawnInteractiveInput,
} from "../Services/WorkspaceExecution.ts";

const localError = (operation: string, detail: string, cause?: unknown) =>
  new WorkspaceExecutionError({
    kind: "local",
    operation,
    detail,
    cause,
  });

const filesystemErrorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const decodeProcessChunk = (chunk: string | Uint8Array): string =>
  typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);

export interface LocalWorkspaceExecutionDeps {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly ptyAdapter: PtyAdapterShape;
  readonly scope: Scope.Scope;
}

export const createLocalWorkspaceExecution = (
  deps: LocalWorkspaceExecutionDeps,
  workspaceRoot: string,
): WorkspaceExecution => {
  const { fileSystem, path, spawner, ptyAdapter, scope } = deps;

  const resolvePath = (targetPath: string) =>
    path.isAbsolute(targetPath) ? targetPath : path.join(workspaceRoot, targetPath);

  const fileSystemApi: WorkspaceExecution["fileSystem"] = {
    list: (targetPath) =>
      Effect.gen(function* () {
        const absolutePath = resolvePath(targetPath);
        const entries = yield* fileSystem
          .readDirectory(absolutePath)
          .pipe(
            Effect.mapError((cause) =>
              localError("fileSystem.list", filesystemErrorMessage(cause), cause),
            ),
          );
        return yield* Effect.forEach(entries, (name) =>
          Effect.gen(function* () {
            const entryPath = path.join(absolutePath, name);
            const info = yield* fileSystem.stat(entryPath).pipe(Effect.orDie);
            return {
              name,
              path: entryPath,
              type: info.type === "Directory" ? ("directory" as const) : ("file" as const),
            };
          }),
        );
      }),
    stat: (targetPath) =>
      Effect.gen(function* () {
        const absolutePath = resolvePath(targetPath);
        const info = yield* fileSystem
          .stat(absolutePath)
          .pipe(
            Effect.mapError((cause) =>
              localError("fileSystem.stat", filesystemErrorMessage(cause), cause),
            ),
          );
        return {
          path: absolutePath,
          isDirectory: info.type === "Directory",
          size: Number(info.size),
        };
      }),
    readFileString: (targetPath) =>
      fileSystem
        .readFileString(resolvePath(targetPath))
        .pipe(
          Effect.mapError((cause) =>
            localError("fileSystem.readFileString", filesystemErrorMessage(cause), cause),
          ),
        ),
    readFileBytes: (targetPath) =>
      fileSystem
        .readFile(resolvePath(targetPath))
        .pipe(
          Effect.mapError((cause) =>
            localError("fileSystem.readFileBytes", filesystemErrorMessage(cause), cause),
          ),
        ),
    writeFileString: (input) =>
      fileSystem
        .writeFileString(resolvePath(input.path), input.contents)
        .pipe(
          Effect.mapError((cause) =>
            localError("fileSystem.writeFileString", filesystemErrorMessage(cause), cause),
          ),
        ),
    makeDirectory: (targetPath, options) =>
      fileSystem
        .makeDirectory(resolvePath(targetPath), {
          recursive: options?.recursive ?? false,
        })
        .pipe(
          Effect.mapError((cause) =>
            localError("fileSystem.makeDirectory", filesystemErrorMessage(cause), cause),
          ),
        ),
    unlink: (targetPath) =>
      fileSystem
        .remove(resolvePath(targetPath))
        .pipe(
          Effect.mapError((cause) =>
            localError("fileSystem.unlink", filesystemErrorMessage(cause), cause),
          ),
        ),
    rmdir: (targetPath) =>
      fileSystem
        .remove(resolvePath(targetPath))
        .pipe(
          Effect.mapError((cause) =>
            localError("fileSystem.rmdir", filesystemErrorMessage(cause), cause),
          ),
        ),
    rename: (fromPath, toPath) =>
      fileSystem
        .rename(resolvePath(fromPath), resolvePath(toPath))
        .pipe(
          Effect.mapError((cause) =>
            localError("fileSystem.rename", filesystemErrorMessage(cause), cause),
          ),
        ),
  };

  const terminal: WorkspaceExecution["terminal"] = {
    open: (openInput) =>
      Effect.gen(function* () {
        const shell =
          process.platform === "win32"
            ? (process.env.ComSpec ?? "cmd.exe")
            : (process.env.SHELL ?? "/bin/bash");
        const pty = yield* ptyAdapter
          .spawn({
            shell,
            cwd: openInput.cwd,
            cols: openInput.cols,
            rows: openInput.rows,
            env: {
              ...process.env,
              ...Object.fromEntries(
                Object.entries(openInput.env ?? {}).filter((entry): entry is [string, string] => {
                  return entry[1] !== undefined;
                }),
              ),
            },
          })
          .pipe(
            Effect.mapError((cause) =>
              localError(
                "terminal.open",
                cause instanceof Error ? cause.message : String(cause),
                cause,
              ),
            ),
          );

        const outputQueue = yield* Queue.unbounded<string>();
        const exitQueue = yield* Queue.unbounded<number>();

        const detachData = pty.onData((chunk) => {
          void Queue.offer(outputQueue, chunk).pipe(Effect.runPromise);
        });
        const detachExit = pty.onExit((event) => {
          void Queue.offer(exitQueue, event.exitCode).pipe(Effect.runPromise);
        });

        return {
          write: (data) =>
            Effect.sync(() => {
              pty.write(data);
            }),
          resize: (cols, rows) =>
            Effect.sync(() => {
              pty.resize(cols, rows);
            }),
          output: Stream.fromQueue(outputQueue),
          exited: Queue.take(exitQueue).pipe(
            Effect.mapError(() => localError("terminal.exited", "PTY exited without code")),
            Effect.ensuring(
              Effect.sync(() => {
                detachData();
                detachExit();
              }),
            ),
          ),
          close: () =>
            Effect.sync(() => {
              detachData();
              detachExit();
              pty.kill();
            }),
        };
      }),
  };

  const spawnInteractive = (spawnInput: WorkspaceSpawnInteractiveInput) =>
    Effect.gen(function* () {
      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawnInput.command, [...spawnInput.args], {
            cwd: spawnInput.cwd,
            env: {
              ...process.env,
              ...Object.fromEntries(
                Object.entries(spawnInput.env ?? {}).filter((entry): entry is [string, string] => {
                  return entry[1] !== undefined;
                }),
              ),
            },
          }),
        )
        .pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.mapError((cause) =>
            localError("spawnInteractive", "Failed to spawn process", cause),
          ),
        );

      const outputQueue = yield* Queue.unbounded<string>();
      const stderrQueue = yield* Queue.unbounded<string>();

      yield* Stream.runForEach(child.stdout, (chunk: string | Uint8Array) =>
        Queue.offer(outputQueue, decodeProcessChunk(chunk)),
      ).pipe(Effect.forkIn(scope));

      yield* Stream.runForEach(child.stderr, (chunk: string | Uint8Array) =>
        Queue.offer(stderrQueue, decodeProcessChunk(chunk)),
      ).pipe(Effect.forkIn(scope));

      const abortListener = () => {
        void child.kill().pipe(Effect.runPromise);
      };
      spawnInput.signal?.addEventListener("abort", abortListener, { once: true });

      return {
        write: (data: string | Uint8Array) =>
          Stream.run(
            Stream.encodeText(
              Stream.make(typeof data === "string" ? data : new TextDecoder().decode(data)),
            ),
            child.stdin,
          ).pipe(
            Effect.mapError((cause) =>
              localError("spawnInteractive.write", "Failed to write stdin", cause),
            ),
          ),
        stdout: Stream.fromQueue(outputQueue) as Stream.Stream<string, WorkspaceExecutionError>,
        stderr: Stream.fromQueue(stderrQueue) as Stream.Stream<string, WorkspaceExecutionError>,
        exited: child.exitCode.pipe(
          Effect.map((code) => Number(code ?? 1)),
          Effect.mapError((cause) =>
            localError("spawnInteractive.exited", "Process exit failed", cause),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              spawnInput.signal?.removeEventListener("abort", abortListener);
            }),
          ),
        ),
        kill: (_signal?: NodeJS.Signals) =>
          child
            .kill()
            .pipe(
              Effect.mapError((cause) =>
                localError("spawnInteractive.kill", "Failed to kill process", cause),
              ),
            ),
      };
    });

  const exec: WorkspaceExecution["exec"] = (execInput) =>
    Effect.gen(function* () {
      const cwd = execInput.cwd ?? workspaceRoot;
      const shellCommand =
        process.platform === "win32"
          ? {
              command: process.env.ComSpec ?? "cmd.exe",
              args: ["/d", "/s", "/c", execInput.command] as const,
            }
          : { command: process.env.SHELL ?? "/bin/sh", args: ["-lc", execInput.command] as const };
      const result = yield* Effect.tryPromise({
        try: () =>
          runProcess(shellCommand.command, shellCommand.args, {
            cwd,
            env: execInput.env,
            allowNonZeroExit: true,
          }),
        catch: (cause) =>
          localError("exec", cause instanceof Error ? cause.message : "exec failed", cause),
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code ?? 1,
      };
    });

  return {
    kind: "local",
    workspaceRoot,
    spawnInteractive,
    exec,
    fileSystem: fileSystemApi,
    terminal,
  };
};
