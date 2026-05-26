import * as OS from "node:os";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspacePaths,
  WorkspacePathOutsideRootError,
  WorkspaceRootCreateFailedError,
  WorkspaceRootNotDirectoryError,
  WorkspaceRootNotExistsError,
  type WorkspacePathsShape,
} from "../Services/WorkspacePaths.ts";
import { resolveRelativePathWithinPosixRoot } from "../posixPaths.ts";

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(OS.homedir(), input.slice(2));
  }
  return input;
}

export const makeWorkspacePaths = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const normalizeWorkspaceRoot: WorkspacePathsShape["normalizeWorkspaceRoot"] = Effect.fn(
    "WorkspacePaths.normalizeWorkspaceRoot",
  )(function* (workspaceRoot, options) {
    const normalizedWorkspaceRoot = path.resolve(expandHomePath(workspaceRoot.trim(), path));
    let workspaceStat = yield* fileSystem
      .stat(normalizedWorkspaceRoot)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!workspaceStat && options?.createIfMissing) {
      yield* fileSystem.makeDirectory(normalizedWorkspaceRoot, { recursive: true }).pipe(
        Effect.mapError(
          () =>
            new WorkspaceRootCreateFailedError({
              workspaceRoot,
              normalizedWorkspaceRoot,
            }),
        ),
      );
      workspaceStat = yield* fileSystem
        .stat(normalizedWorkspaceRoot)
        .pipe(Effect.catch(() => Effect.succeed(null)));
    }
    if (!workspaceStat) {
      return yield* new WorkspaceRootNotExistsError({
        workspaceRoot,
        normalizedWorkspaceRoot,
      });
    }
    if (workspaceStat.type !== "Directory") {
      return yield* new WorkspaceRootNotDirectoryError({
        workspaceRoot,
        normalizedWorkspaceRoot,
      });
    }
    return normalizedWorkspaceRoot;
  });

  const normalizeRemoteWorkspaceRoot: WorkspacePathsShape["normalizeRemoteWorkspaceRoot"] =
    Effect.fn("WorkspacePaths.normalizeRemoteWorkspaceRoot")(function* (workspaceRoot) {
      const trimmed = workspaceRoot.trim();
      if (trimmed.length === 0) {
        return yield* new WorkspaceRootNotExistsError({
          workspaceRoot,
          normalizedWorkspaceRoot: trimmed,
        });
      }
      return trimmed;
    });

  const resolveRelativePathWithinRoot: WorkspacePathsShape["resolveRelativePathWithinRoot"] =
    Effect.fn("WorkspacePaths.resolveRelativePathWithinRoot")(function* (input) {
      const normalizedInputPath = input.relativePath.trim();

      // Resolve the absolute path: if the input is already absolute, resolve it
      // directly (e.g. a drive-letter path on Windows); otherwise resolve
      // against the workspace root.  Both branches must pass the same
      // "stays-within-root" check below, so an attacker can't escape by
      // supplying an absolute path that points outside the project.
      const absolutePath = path.isAbsolute(normalizedInputPath)
        ? path.resolve(normalizedInputPath)
        : path.resolve(input.workspaceRoot, normalizedInputPath);

      const relativeToRoot = toPosixRelativePath(path.relative(input.workspaceRoot, absolutePath));
      const normalizedRelative = relativeToRoot.length === 0 ? "." : relativeToRoot;
      if (
        normalizedRelative.startsWith("../") ||
        normalizedRelative === ".." ||
        path.isAbsolute(normalizedRelative)
      ) {
        return yield* new WorkspacePathOutsideRootError({
          workspaceRoot: input.workspaceRoot,
          relativePath: input.relativePath,
        });
      }

      return {
        absolutePath,
        relativePath: normalizedRelative,
      };
    });

  const resolveRelativePathWithinPosixRootImpl: WorkspacePathsShape["resolveRelativePathWithinPosixRoot"] =
    Effect.fn("WorkspacePaths.resolveRelativePathWithinPosixRoot")(function* (input) {
      const resolved = resolveRelativePathWithinPosixRoot(input);
      if ("outsideRoot" in resolved) {
        return yield* new WorkspacePathOutsideRootError({
          workspaceRoot: input.workspaceRoot,
          relativePath: input.relativePath,
        });
      }
      return resolved;
    });

  return {
    normalizeWorkspaceRoot,
    normalizeRemoteWorkspaceRoot,
    resolveRelativePathWithinRoot,
    resolveRelativePathWithinPosixRoot: resolveRelativePathWithinPosixRootImpl,
  } satisfies WorkspacePathsShape;
});

export const WorkspacePathsLive = Layer.effect(WorkspacePaths, makeWorkspacePaths);
