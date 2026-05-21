import type { SFTPWrapper } from "ssh2";
import { Effect, Layer } from "effect";

import { SshFileSystemError } from "../Errors.ts";
import { SshConnectionPool } from "../Services/SshConnectionPool.ts";
import { SshFileSystem } from "../Services/SshFileSystem.ts";
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

export const makeSshFileSystem = Effect.gen(function* () {
  const pool = yield* SshConnectionPool;

  const list: (typeof SshFileSystem)["Service"]["list"] = Effect.fn("SshFileSystem.list")(
    function* (input) {
      const lease = yield* pool.acquire(input.connectionId, { lane: "workspace" });
      const entries = yield* openSftp(input.connectionId, lease.client).pipe(
        Effect.flatMap((sftp) =>
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
        ),
        Effect.ensuring(lease.release()),
      );
      return entries;
    },
  );

  const stat: (typeof SshFileSystem)["Service"]["stat"] = Effect.fn("SshFileSystem.stat")(
    function* (input) {
      const lease = yield* pool.acquire(input.connectionId, { lane: "workspace" });
      const fileStat = yield* openSftp(input.connectionId, lease.client).pipe(
        Effect.flatMap((sftp) =>
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
        ),
        Effect.ensuring(lease.release()),
      );
      return fileStat;
    },
  );

  const readSftpFileBuffer = (connectionId: string, targetPath: string, operation: string) =>
    Effect.gen(function* () {
      const lease = yield* pool.acquire(connectionId, { lane: "workspace" });
      const buffer = yield* openSftp(connectionId, lease.client).pipe(
        Effect.flatMap((sftp) =>
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
        ),
        Effect.ensuring(lease.release()),
      );
      return buffer;
    });

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
    const lease = yield* pool.acquire(input.connectionId, { lane: "workspace" });
    yield* openSftp(input.connectionId, lease.client).pipe(
      Effect.flatMap((sftp) =>
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
      ),
      Effect.ensuring(lease.release()),
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
    const lease = yield* pool.acquire(input.connectionId, { lane: "workspace" });
    yield* openSftp(input.connectionId, lease.client).pipe(
      Effect.flatMap((sftp) => {
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
      }),
      Effect.ensuring(lease.release()),
    );
  });

  return {
    list,
    stat,
    readFileString,
    readFileBytes,
    writeFileString,
    makeDirectory,
  } satisfies (typeof SshFileSystem)["Service"];
});

export const SshFileSystemLive = Layer.effect(SshFileSystem, makeSshFileSystem);
