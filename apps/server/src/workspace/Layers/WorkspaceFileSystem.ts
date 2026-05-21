import { Effect, FileSystem, Layer, Option, Path } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";
import { WorkspaceExecutionResolver } from "../Services/WorkspaceExecution.ts";
import { dirnamePosix } from "../posixPaths.ts";
import { resolveWorkspaceExecutionByCwd } from "../resolveWorkspaceExecutionByCwd.ts";

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;
  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const workspaceExecutionResolver = yield* WorkspaceExecutionResolver;
    const sshExecutionOption = yield* resolveWorkspaceExecutionByCwd(input.cwd).pipe(
      Effect.provideService(ProjectionSnapshotQuery, projectionSnapshotQuery),
      Effect.provideService(WorkspaceExecutionResolver, workspaceExecutionResolver),
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.resolveExecution",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      ),
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
  return { writeFile } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
