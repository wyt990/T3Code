import { Effect, FileSystem, Layer, Option, Path } from "effect";

import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecutionResolverShape,
} from "../Services/WorkspaceExecution.ts";
import type { WorkspaceDirectoryEntry } from "../Services/WorkspaceExecution.ts";
import { dirnamePosix, isPosixAbsolutePath, joinPosix } from "../posixPaths.ts";
import { resolveWorkspaceExecutionByCwd } from "../resolveWorkspaceExecutionByCwd.ts";

const resolveExecution = (
  inputCwd: string,
  projectionSnapshotQuery: ProjectionSnapshotQueryShape,
  workspaceExecutionResolver: WorkspaceExecutionResolverShape,
) =>
  resolveWorkspaceExecutionByCwd(inputCwd).pipe(
    Effect.provideService(ProjectionSnapshotQuery, projectionSnapshotQuery),
    Effect.provideService(WorkspaceExecutionResolver, workspaceExecutionResolver),
    Effect.mapError(
      (cause) =>
        new WorkspaceFileSystemError({
          cwd: inputCwd,
          operation: "workspaceFileSystem.resolveExecution",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    ),
  );

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const workspaceExecutionResolver = yield* WorkspaceExecutionResolver;
  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const sshExecutionOption = yield* resolveExecution(
      input.cwd,
      projectionSnapshotQuery,
      workspaceExecutionResolver,
    );

    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });

      yield* execution.fileSystem
        .makeDirectory(dirnamePosix(target.absolutePath), { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.makeDirectory",
                detail: cause.detail,
                cause,
              }),
          ),
        );
      yield* execution.fileSystem
        .writeFileString({
          path: target.absolutePath,
          contents: input.contents,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.writeFile",
                detail: cause.detail,
                cause,
              }),
          ),
        );
      yield* workspaceEntries.invalidate(input.cwd);
      return { relativePath: target.relativePath };
    }

    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const sshExecutionOption = yield* resolveExecution(
        input.cwd,
        projectionSnapshotQuery,
        workspaceExecutionResolver,
      );
      if (Option.isSome(sshExecutionOption)) {
        const execution = sshExecutionOption.value;
        const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
        });
        return yield* execution.fileSystem.readFileString(target.absolutePath).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.readFile",
                detail: cause.detail,
                cause,
              }),
          ),
        );
      }
      const normalizedInputPath = input.relativePath.trim();
      if (path.isAbsolute(normalizedInputPath)) {
        return yield* fileSystem.readFileString(normalizedInputPath).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.readFile",
                detail: cause.message,
                cause,
              }),
          ),
        );
      }
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      return yield* fileSystem.readFileString(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.readFile",
              detail: cause.message,
              cause,
            }),
        ),
      );
    },
  );

  const listDirectory: WorkspaceFileSystemShape["listDirectory"] = Effect.fn(
    "WorkspaceFileSystem.listDirectory",
  )(function* (input) {
    const sshExecutionOption = yield* resolveExecution(
      input.cwd,
      projectionSnapshotQuery,
      workspaceExecutionResolver,
    );
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;

      // 支持地址栏输入的绝对路径（如 /other/path），与本地行为一致
      const normalizedInputPath = input.relativePath.trim().replaceAll("\\", "/");
      if (isPosixAbsolutePath(normalizedInputPath)) {
        const rawEntries = yield* execution.fileSystem.list(normalizedInputPath).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.listDirectory",
                detail: cause.detail,
                cause,
              }),
          ),
        );
        return rawEntries.map((e) => ({
          ...e,
          path: joinPosix(normalizedInputPath, e.name),
        }));
      }

      // 相对路径
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      const rawEntries = yield* execution.fileSystem.list(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.listDirectory",
              detail: cause.detail,
              cause,
            }),
        ),
      );
      // 将绝对路径转换为相对于 workspaceRoot 的相对路径
      return rawEntries.map((e) => ({
        ...e,
        path: joinPosix(target.relativePath, e.name),
      }));
    }
    const normalizedInputPath = input.relativePath.trim();
    const isAbsolutePath = path.isAbsolute(normalizedInputPath);

    if (isAbsolutePath) {
      // 地址栏输入的绝对路径（如 f:\），直接浏览该目录
      const names = yield* fileSystem.readDirectory(normalizedInputPath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.listDirectory",
              detail: cause.message,
              cause,
            }),
        ),
      );
      const entries: WorkspaceDirectoryEntry[] = [];
      for (const name of names) {
        const statOption = yield* fileSystem.stat(path.join(normalizedInputPath, name)).pipe(
          Effect.option,
        );
        if (Option.isNone(statOption)) continue; // 跳过无法访问的条目（如系统保护目录）
        const info = statOption.value;
        entries.push({
          name,
          path: path.join(normalizedInputPath, name),
          type: info.type === "Directory" ? "directory" : "file",
        });
      }
      return entries;
    }

    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    const names = yield* fileSystem.readDirectory(target.absolutePath).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.listDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    const entries: WorkspaceDirectoryEntry[] = [];
    for (const name of names) {
      const stat = yield* fileSystem.stat(path.join(target.absolutePath, name)).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: joinPosix(input.relativePath, name),
              operation: "workspaceFileSystem.listDirectory.stat",
              detail: cause.message,
              cause,
            }),
        ),
      );
      entries.push({
        name,
        path: joinPosix(target.relativePath, name),
        type: stat.type === "Directory" ? "directory" : "file",
      });
    }
    return entries;
  });

  const stat: WorkspaceFileSystemShape["stat"] = Effect.fn("WorkspaceFileSystem.stat")(
    function* (input) {
      const sshExecutionOption = yield* resolveExecution(
        input.cwd,
        projectionSnapshotQuery,
        workspaceExecutionResolver,
      );
      if (Option.isSome(sshExecutionOption)) {
        const execution = sshExecutionOption.value;
        const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
        });
        return yield* execution.fileSystem.stat(target.absolutePath).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.stat",
                detail: cause.detail,
                cause,
              }),
          ),
        );
      }
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      const info = yield* fileSystem.stat(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.stat",
              detail: cause.message,
              cause,
            }),
        ),
      );
      return {
        path: target.absolutePath,
        isDirectory: info.type === "Directory",
        size: Number(info.size),
      };
    },
  );

  const createDirectory: WorkspaceFileSystemShape["createDirectory"] = Effect.fn(
    "WorkspaceFileSystem.createDirectory",
  )(function* (input) {
    const sshExecutionOption = yield* resolveExecution(
      input.cwd,
      projectionSnapshotQuery,
      workspaceExecutionResolver,
    );
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      return yield* execution.fileSystem
        .makeDirectory(target.absolutePath, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.createDirectory",
                detail: cause.detail,
                cause,
              }),
          ),
        );
    }
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    return yield* fileSystem.makeDirectory(target.absolutePath, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.createDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
  });

  const deleteFile: WorkspaceFileSystemShape["deleteFile"] = Effect.fn(
    "WorkspaceFileSystem.deleteFile",
  )(function* (input) {
    const sshExecutionOption = yield* resolveExecution(
      input.cwd,
      projectionSnapshotQuery,
      workspaceExecutionResolver,
    );
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      const fileStat = yield* execution.fileSystem.stat(target.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.deleteFile.stat",
              detail: cause.detail,
              cause,
            }),
        ),
      );
      if (fileStat.isDirectory) {
        yield* execution.fileSystem.rmdir(target.absolutePath).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.deleteFile.rmdir",
                detail: cause.detail,
                cause,
              }),
          ),
        );
      } else {
        yield* execution.fileSystem.unlink(target.absolutePath).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                operation: "workspaceFileSystem.deleteFile.unlink",
                detail: cause.detail,
                cause,
              }),
          ),
        );
      }
      yield* workspaceEntries.invalidate(input.cwd);
      return;
    }
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    yield* fileSystem.remove(target.absolutePath, { recursive: input.recursive ?? false }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.deleteFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
  });

  const renameFile: WorkspaceFileSystemShape["renameFile"] = Effect.fn(
    "WorkspaceFileSystem.renameFile",
  )(function* (input) {
    const sshExecutionOption = yield* resolveExecution(
      input.cwd,
      projectionSnapshotQuery,
      workspaceExecutionResolver,
    );
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const fromTarget = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.fromPath,
      });
      const toTarget = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.toPath,
      });
      yield* execution.fileSystem.rename(fromTarget.absolutePath, toTarget.absolutePath).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.fromPath,
              operation: "workspaceFileSystem.renameFile",
              detail: cause.detail,
              cause,
            }),
        ),
      );
      yield* workspaceEntries.invalidate(input.cwd);
      return input.toPath;
    }
    const fromTarget = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.fromPath,
    });
    const toTarget = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.toPath,
    });
    yield* fileSystem.rename(fromTarget.absolutePath, toTarget.absolutePath).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.fromPath,
            operation: "workspaceFileSystem.renameFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return input.toPath;
  });

  return {
    writeFile,
    readFile,
    listDirectory,
    stat,
    createDirectory,
    deleteFile,
    renameFile,
  } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
