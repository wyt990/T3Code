import type { ClientChannel } from "ssh2";
import { Effect, Queue, Stream } from "effect";

import type { SshConnectionPoolShape } from "../../ssh/Services/SshConnectionPool.ts";
import type { SshFileSystemShape } from "../../ssh/Services/SshFileSystem.ts";
import type { SshProcessRunnerShape } from "../../ssh/Services/SshProcessRunner.ts";
import { attachSshChannelLifecycle } from "../../ssh/sshChannelLifecycle.ts";
import { shellQuotePosix } from "../../ssh/ssh2Adapter.ts";
import {
  toWorkspaceExecutionError,
  type WorkspaceExecution,
  type WorkspaceTerminalSession,
} from "../Services/WorkspaceExecution.ts";
import { mapWorkspaceExecutionError } from "./executionErrorMapping.ts";

export interface SshWorkspaceExecutionDeps {
  readonly runner: SshProcessRunnerShape;
  readonly remoteFileSystem: SshFileSystemShape;
  readonly pool: SshConnectionPoolShape;
}

export const createSshWorkspaceExecution = (
  deps: SshWorkspaceExecutionDeps,
  input: {
    readonly connectionId: string;
    readonly workspaceRoot: string;
  },
): WorkspaceExecution => {
  const { runner, remoteFileSystem, pool } = deps;
  const mapExec = mapWorkspaceExecutionError("ssh", "exec");
  const mapSpawn = mapWorkspaceExecutionError("ssh", "spawnInteractive");
  const mapList = mapWorkspaceExecutionError("ssh", "fileSystem.list");
  const mapStat = mapWorkspaceExecutionError("ssh", "fileSystem.stat");
  const mapReadFile = mapWorkspaceExecutionError("ssh", "fileSystem.readFileString");
  const mapReadFileBytes = mapWorkspaceExecutionError("ssh", "fileSystem.readFileBytes");
  const mapWriteFile = mapWorkspaceExecutionError("ssh", "fileSystem.writeFileString");
  const mapMakeDirectory = mapWorkspaceExecutionError("ssh", "fileSystem.makeDirectory");
  const mapTerminal = mapWorkspaceExecutionError("ssh", "terminal.open");

  const openTerminal: WorkspaceExecution["terminal"]["open"] = (openInput) =>
    mapTerminal(
      Effect.gen(function* () {
        const lease = yield* pool.acquire(input.connectionId, { lane: "interactive" });

        // Removed logging statements due to build errors
        // logDebug("[SshExecution] calling ssh2 shell", { connectionId: input.connectionId });

        const channel = yield* Effect.tryPromise({
          try: () =>
            new Promise<ClientChannel>((resolve, reject) => {
              lease.client.shell(
                {
                  cols: openInput.cols,
                  rows: openInput.rows,
                  term: "xterm-256color",
                },
                (error, stream) => {
                  if (error !== undefined) {
                    // Removed: yield* cannot be used in callback
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
            return toWorkspaceExecutionError(
              "ssh",
              "terminal.open",
              `SSH terminal open failed: ${errorDetail}\nStack: ${errorStack ?? "N/A"}`,
            );
          },
        }).pipe(
          Effect.catch((error) => lease.release().pipe(Effect.flatMap(() => Effect.fail(error)))),
        );

        const outputQueue = yield* Queue.unbounded<string>();
        const exitQueue = yield* Queue.unbounded<number>();
        const initialCommand =
          openInput.cwd === "~" ? "cd ~\n" : `cd ${shellQuotePosix(openInput.cwd)}\n`;

        channel.on("data", (chunk: Buffer) => {
          void Queue.offer(outputQueue, chunk.toString("utf8")).pipe(Effect.runPromise);
        });

        const { closeChannel } = attachSshChannelLifecycle({
          channel,
          exitQueue,
          releaseLease: () => lease.release(),
        });

        channel.write(initialCommand);

        const session: WorkspaceTerminalSession = {
          write: (data: string) =>
            Effect.sync(() => {
              channel.write(data);
            }),
          resize: (cols: number, rows: number) =>
            Effect.sync(() => {
              channel.setWindow(rows, cols, 0, 0);
            }),
          output: Stream.fromQueue(outputQueue),
          exited: Queue.take(exitQueue).pipe(
            Effect.mapError(() =>
              toWorkspaceExecutionError("ssh", "terminal.exited", "SSH shell exited without code"),
            ),
          ),
          close: closeChannel,
        };
        return session;
      }),
    );

  return {
    kind: "ssh",
    workspaceRoot: input.workspaceRoot,
    sshConnectionId: input.connectionId,
    spawnInteractive: (spawnInput) => {
      const env =
        spawnInput.env === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(spawnInput.env).filter((entry): entry is [string, string] => {
                return entry[1] !== undefined;
              }),
            );
      return mapSpawn(
        runner.spawnInteractive({
          connectionId: input.connectionId,
          lane: "interactive",
          command: spawnInput.command,
          args: spawnInput.args,
          cwd: spawnInput.cwd,
          ...(env === undefined ? {} : { env }),
          ...(spawnInput.signal === undefined ? {} : { signal: spawnInput.signal }),
        }),
      );
    },
    exec: (execInput) => {
      const env =
        execInput.env === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(execInput.env).filter((entry): entry is [string, string] => {
                return entry[1] !== undefined;
              }),
            );
      return mapExec(
        runner.exec({
          connectionId: input.connectionId,
          ...(execInput.sshLane === undefined ? {} : { lane: execInput.sshLane }),
          command: execInput.command,
          cwd: execInput.cwd ?? input.workspaceRoot,
          ...(env === undefined ? {} : { env }),
          ...(execInput.stdin === undefined ? {} : { stdin: execInput.stdin }),
        }),
      );
    },
    fileSystem: {
      list: (targetPath) =>
        mapList(remoteFileSystem.list({ connectionId: input.connectionId, path: targetPath })),
      stat: (targetPath) =>
        mapStat(remoteFileSystem.stat({ connectionId: input.connectionId, path: targetPath })),
      readFileString: (targetPath) =>
        mapReadFile(
          remoteFileSystem.readFileString({
            connectionId: input.connectionId,
            path: targetPath,
          }),
        ),
      readFileBytes: (targetPath) =>
        mapReadFileBytes(
          remoteFileSystem.readFileBytes({
            connectionId: input.connectionId,
            path: targetPath,
          }),
        ),
      writeFileString: (writeInput) =>
        mapWriteFile(
          remoteFileSystem.writeFileString({
            connectionId: input.connectionId,
            path: writeInput.path,
            contents: writeInput.contents,
          }),
        ),
      makeDirectory: (targetPath, options) =>
        mapMakeDirectory(
          remoteFileSystem.makeDirectory({
            connectionId: input.connectionId,
            path: targetPath,
            ...(options?.recursive === undefined ? {} : { recursive: options.recursive }),
          }),
        ),
    },
    terminal: {
      open: openTerminal,
    },
  };
};
