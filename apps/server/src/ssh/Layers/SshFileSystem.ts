import type { SFTPWrapper } from "ssh2";
import { Effect, Layer } from "effect";

import { SshFileSystemError } from "../Errors.ts";
import { SshConnectionPool } from "../Services/SshConnectionPool.ts";
import { SshFileSystem } from "../Services/SshFileSystem.ts";
import { sharedSshLaneConcurrency } from "../sshLaneConcurrency.ts";
import { DEFAULT_SSH_CONNECTION_LANE, type SshConnectionLane } from "../sshConnectionLane.ts";
import type {
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryEntryType,
  WorkspaceFileStat,
} from "../../workspace/Services/WorkspaceExecution.ts";

const toFsError = (input: {
  readonly connectionId: string;
  readonly path: string;
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}) =>
  new SshFileSystemError({
    connectionId: input.connectionId,
    path: input.path,
    operation: input.operation,
    detail: input.detail,
    cause: input.cause,
  });

const entryTypeFromAttrs = (attrs: {
  readonly isDirectory?: () => boolean;
  readonly isSymbolicLink?: () => boolean;
}): WorkspaceDirectoryEntryType => {
  if (attrs.isSymbolicLink?.()) {
    return "symlink";
  }
  if (attrs.isDirectory?.()) {
    return "directory";
  }
  return "file";
};

const openSftp = (
  connectionId: string,
  client: {
    sftp: (callback: (error: Error | undefined, sftp?: SFTPWrapper) => void) => void;
  },
) =>
  Effect.tryPromise({
    try: () =>
      new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((error, sftp) => {
          if (error !== undefined || sftp === undefined) {
            reject(error ?? new Error("SFTP session unavailable"));
            return;
          }
          resolve(sftp);
        });
      }),
    catch: (cause: unknown): SshFileSystemError =>
      toFsError({
        connectionId,
        path: "",
        operation: "sftp-open",
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

const closeSftp = (sftp: SFTPWrapper) =>
  Effect.sync(() => {
    try {
      sftp.end();
    } catch {
      // SFTP session may already be closed.
    }
  });

export const makeSshFileSystem = Effect.gen(function* () {
  const pool = yield* SshConnectionPool;
  const laneConcurrency = yield* sharedSshLaneConcurrency();

  const resolveLane = (lane: SshConnectionLane | undefined): SshConnectionLane =>
    lane ?? DEFAULT_SSH_CONNECTION_LANE;

  const withSftpSession = <A, E>(
    connectionId: string,
    lane: SshConnectionLane,
    use: (sftp: SFTPWrapper) => Effect.Effect<A, E>,
  ) =>
    laneConcurrency.withLanePermit(
      connectionId,
      lane,
      Effect.gen(function* () {
        const lease = yield* pool.acquire(connectionId, { lane });
        return yield* openSftp(connectionId, lease.client).pipe(
          Effect.flatMap((sftp) => use(sftp).pipe(Effect.ensuring(closeSftp(sftp)))),
          Effect.ensuring(lease.release()),
        );
      }),
    );

  const list: (typeof SshFileSystem)["Service"]["list"] = Effect.fn("SshFileSystem.list")(
    function* (input) {
      const lane = resolveLane(input.lane);
      return yield* withSftpSession(input.connectionId, lane, (sftp) =>
        Effect.tryPromise({
          try: () =>
            new Promise<ReadonlyArray<WorkspaceDirectoryEntry>>((resolve, reject) => {
              sftp.readdir(input.path, (error, listEntries) => {
                if (error !== undefined) {
                  reject(error);
                  return;
                }
                resolve(
                  (listEntries ?? []).map((entry) => ({
                    name: entry.filename,
                    path:
                      input.path === "/"
                        ? `/${entry.filename}`
                        : `${input.path.replace(/\/$/, "")}/${entry.filename}`,
                    type: entryTypeFromAttrs(entry.attrs),
                  })),
                );
              });
            }),
          catch: (cause: unknown): SshFileSystemError =>
            toFsError({
              connectionId: input.connectionId,
              path: input.path,
              operation: "list",
              detail: cause instanceof Error ? cause.message : "SFTP readdir failed",
              cause,
            }),
        }),
      );
    },
  );

  const stat: (typeof SshFileSystem)["Service"]["stat"] = Effect.fn("SshFileSystem.stat")(
    function* (input) {
      return yield* withSftpSession(input.connectionId, "workspace", (sftp) =>
        Effect.tryPromise({
          try: () =>
            new Promise<WorkspaceFileStat>((resolve, reject) => {
              sftp.stat(input.path, (error, attrs) => {
                if (error !== undefined || attrs === undefined) {
                  reject(error ?? new Error("SFTP stat returned no attributes"));
                  return;
                }
                resolve({
                  path: input.path,
                  isDirectory: attrs.isDirectory(),
                  size: attrs.size,
                });
              });
            }),
          catch: (cause: unknown): SshFileSystemError =>
            toFsError({
              connectionId: input.connectionId,
              path: input.path,
              operation: "stat",
              detail: cause instanceof Error ? cause.message : "SFTP stat failed",
              cause,
            }),
        }),
      );
    },
  );

  const readSftpFileBuffer = (connectionId: string, targetPath: string, operation: string) =>
    withSftpSession(connectionId, "workspace", (sftp) =>
      Effect.tryPromise({
        try: () =>
          new Promise<Buffer>((resolve, reject) => {
            sftp.readFile(targetPath, (error, data) => {
              if (error !== undefined) {
                reject(error);
                return;
              }
              resolve(data ?? Buffer.alloc(0));
            });
          }),
        catch: (cause: unknown): SshFileSystemError =>
          toFsError({
            connectionId,
            path: targetPath,
            operation,
            detail: cause instanceof Error ? cause.message : "SFTP readFile failed",
            cause,
          }),
      }),
    );

  const readFileString: (typeof SshFileSystem)["Service"]["readFileString"] = Effect.fn(
    "SshFileSystem.readFileString",
  )(function* (input) {
    const buffer = yield* readSftpFileBuffer(input.connectionId, input.path, "readFileString");
    return buffer.toString("utf8");
  });

  const readFileBytes: (typeof SshFileSystem)["Service"]["readFileBytes"] = Effect.fn(
    "SshFileSystem.readFileBytes",
  )(function* (input) {
    const buffer = yield* readSftpFileBuffer(input.connectionId, input.path, "readFileBytes");
    return new Uint8Array(buffer);
  });

  const writeFileString: (typeof SshFileSystem)["Service"]["writeFileString"] = Effect.fn(
    "SshFileSystem.writeFileString",
  )(function* (input) {
    yield* withSftpSession(input.connectionId, "workspace", (sftp) =>
      Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            sftp.writeFile(input.path, input.contents, (error) => {
              if (error !== undefined) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
        catch: (cause: unknown): SshFileSystemError =>
          toFsError({
            connectionId: input.connectionId,
            path: input.path,
            operation: "writeFileString",
            detail: cause instanceof Error ? cause.message : "SFTP writeFile failed",
            cause,
          }),
      }),
    );
  });

  const mkdirOnce = (
    connectionId: string,
    sftp: SFTPWrapper,
    targetPath: string,
  ): Effect.Effect<void, SshFileSystemError> =>
    Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          sftp.mkdir(targetPath, (error) => {
            if (error !== undefined) {
              const code = (error as NodeJS.ErrnoException).code;
              if (code === "EEXIST") {
                resolve();
                return;
              }
              reject(error);
              return;
            }
            resolve();
          });
        }),
      catch: (cause: unknown): SshFileSystemError =>
        toFsError({
          connectionId,
          path: targetPath,
          operation: "makeDirectory",
          detail: cause instanceof Error ? cause.message : "SFTP mkdir failed",
          cause,
        }),
    });

  const makeDirectory: (typeof SshFileSystem)["Service"]["makeDirectory"] = Effect.fn(
    "SshFileSystem.makeDirectory",
  )(function* (input) {
    yield* withSftpSession(input.connectionId, "workspace", (sftp) => {
      if (!input.recursive) {
        return mkdirOnce(input.connectionId, sftp, input.path);
      }

      const normalized = input.path.replace(/\/+$/, "");
      const segments = normalized.split("/").filter((segment) => segment.length > 0);
      const isAbsolute = normalized.startsWith("/");
      const paths: string[] = [];
      let current = isAbsolute ? "" : "";
      for (const segment of segments) {
        current =
          current.length === 0 ? (isAbsolute ? `/${segment}` : segment) : `${current}/${segment}`;
        paths.push(current);
      }

      return Effect.forEach(paths, (dirPath) => mkdirOnce(input.connectionId, sftp, dirPath));
    });
  });

  const unlink: (typeof SshFileSystem)["Service"]["unlink"] = Effect.fn("SshFileSystem.unlink")(
    function* (input) {
      yield* withSftpSession(input.connectionId, "workspace", (sftp) =>
        Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              sftp.unlink(input.path, (error) => {
                if (error !== undefined) {
                  reject(error);
                  return;
                }
                resolve();
              });
            }),
          catch: (cause: unknown): SshFileSystemError =>
            toFsError({
              connectionId: input.connectionId,
              path: input.path,
              operation: "unlink",
              detail: cause instanceof Error ? cause.message : "SFTP unlink failed",
              cause,
            }),
        }),
      );
    },
  );

  const rmdir: (typeof SshFileSystem)["Service"]["rmdir"] = Effect.fn("SshFileSystem.rmdir")(
    function* (input) {
      yield* withSftpSession(input.connectionId, "workspace", (sftp) =>
        Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              sftp.rmdir(input.path, (error) => {
                if (error !== undefined) {
                  reject(error);
                  return;
                }
                resolve();
              });
            }),
          catch: (cause: unknown): SshFileSystemError =>
            toFsError({
              connectionId: input.connectionId,
              path: input.path,
              operation: "rmdir",
              detail: cause instanceof Error ? cause.message : "SFTP rmdir failed",
              cause,
            }),
        }),
      );
    },
  );

  const rename: (typeof SshFileSystem)["Service"]["rename"] = Effect.fn("SshFileSystem.rename")(
    function* (input) {
      yield* withSftpSession(input.connectionId, "workspace", (sftp) =>
        Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              sftp.rename(input.fromPath, input.toPath, (error) => {
                if (error !== undefined) {
                  reject(error);
                  return;
                }
                resolve();
              });
            }),
          catch: (cause: unknown): SshFileSystemError =>
            toFsError({
              connectionId: input.connectionId,
              path: input.fromPath,
              operation: "rename",
              detail: cause instanceof Error ? cause.message : "SFTP rename failed",
              cause,
            }),
        }),
      );
    },
  );

  return {
    list,
    stat,
    readFileString,
    readFileBytes,
    writeFileString,
    makeDirectory,
    unlink,
    rmdir,
    rename,
  } satisfies (typeof SshFileSystem)["Service"];
});

export const SshFileSystemLive = Layer.effect(SshFileSystem, makeSshFileSystem);
