import * as FS from "node:fs/promises";
import path from "node:path";
import { dirname, join, normalize, relative } from "node:path";
import { Effect, Option } from "effect";

import { buildGitShellCommand } from "../git/gitWorkspacePaths.ts";
import { runProcess } from "../processRunner.ts";
import type { WorkspaceExecution } from "../workspace/Services/WorkspaceExecution.ts";
import { dirnamePosix, joinPosix, relativePosixPathWithinRoot } from "../workspace/posixPaths.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceExecutionResolver } from "../workspace/Services/WorkspaceExecution.ts";
import {
  resolveWorkspaceExecutionByCwd,
  type ResolveWorkspaceExecutionByCwdError,
} from "../workspace/resolveWorkspaceExecutionByCwd.ts";

export interface ContextWorkspaceAccess {
  readonly kind: "local" | "ssh";
  readonly workspaceRoot: string;
  joinPath(...segments: string[]): string;
  dirnamePath(path: string): string;
  normalizePath(path: string): string;
  relativeFromRoot(absPath: string): string | null;
  pathExistsFile(absPath: string): Promise<boolean>;
  pathExistsDirectory(absPath: string): Promise<boolean>;
  readUtf8(absPath: string): Promise<string>;
  readdirEntries(dirAbs: string): Promise<ReadonlyArray<{ name: string; isDirectory: boolean }>>;
  runGit(
    args: readonly string[],
    options?: { readonly timeoutMs?: number; readonly allowNonZeroExit?: boolean },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

const toPosixRelFromAccess = (access: ContextWorkspaceAccess, absPath: string): string | null => {
  if (access.kind === "ssh") {
    return relativePosixPathWithinRoot(access.workspaceRoot, absPath);
  }
  const rel = relative(access.workspaceRoot, absPath).replace(/\\/g, "/");
  if (rel.startsWith("..") || rel.length === 0) {
    return null;
  }
  return rel;
};

export const createLocalContextWorkspaceAccess = (
  workspaceRoot: string,
): ContextWorkspaceAccess => {
  const root = normalize(workspaceRoot);

  return {
    kind: "local",
    workspaceRoot: root,
    joinPath: (...segments) => {
      if (segments.length === 0) {
        return root;
      }
      const first = segments[0]!;
      if (path.isAbsolute(first)) {
        return normalize(join(...segments));
      }
      return normalize(join(root, ...segments));
    },
    dirnamePath: dirname,
    normalizePath: normalize,
    relativeFromRoot: (absPath) => {
      const rel = relative(root, normalize(absPath)).replace(/\\/g, "/");
      if (rel.startsWith("..") || rel.length === 0) {
        return null;
      }
      return rel;
    },
    pathExistsFile: async (absPath) => {
      try {
        const st = await FS.stat(absPath);
        return st.isFile();
      } catch {
        return false;
      }
    },
    pathExistsDirectory: async (absPath) => {
      try {
        const st = await FS.stat(absPath);
        return st.isDirectory();
      } catch {
        return false;
      }
    },
    readUtf8: (absPath) => FS.readFile(absPath, "utf-8"),
    readdirEntries: async (dirAbs) => {
      const entries = await FS.readdir(dirAbs, { withFileTypes: true });
      return entries.map((ent) => ({
        name: String(ent.name),
        isDirectory: ent.isDirectory(),
      }));
    },
    runGit: async (args, options) => {
      const result = await runProcess("git", [...args], {
        cwd: root,
        timeoutMs: options?.timeoutMs ?? 30_000,
        allowNonZeroExit: options?.allowNonZeroExit ?? false,
      });
      return {
        code: result.code ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };
};

export const createSshContextWorkspaceAccess = (
  workspaceRoot: string,
  execution: WorkspaceExecution,
): ContextWorkspaceAccess => {
  const root = workspaceRoot.replace(/\/+$/, "") || "/";

  const joinUnderRoot = (...segments: string[]): string => {
    if (segments.length === 0) {
      return root;
    }
    const [first, ...rest] = segments;
    if (first === undefined) {
      return root;
    }
    if (first.startsWith("/")) {
      return joinPosix(first, ...rest);
    }
    return joinPosix(root, first, ...rest);
  };

  const runEffect = <A>(effect: Effect.Effect<A, unknown, never>): Promise<A> =>
    Effect.runPromise(effect as Effect.Effect<A, never, never>);

  return {
    kind: "ssh",
    workspaceRoot: root,
    joinPath: joinUnderRoot,
    dirnamePath: dirnamePosix,
    normalizePath: (path) => path.replace(/\/+/g, "/"),
    relativeFromRoot: (absPath) =>
      relativePosixPathWithinRoot(root, absPath.replace(/\/+$/, "") || "/"),
    pathExistsFile: async (absPath) => {
      try {
        const stat = await runEffect(execution.fileSystem.stat(absPath));
        return !stat.isDirectory;
      } catch {
        return false;
      }
    },
    pathExistsDirectory: async (absPath) => {
      try {
        const stat = await runEffect(execution.fileSystem.stat(absPath));
        return stat.isDirectory;
      } catch {
        return false;
      }
    },
    readUtf8: (absPath) => runEffect(execution.fileSystem.readFileString(absPath)),
    readdirEntries: async (dirAbs) => {
      const entries = await runEffect(execution.fileSystem.list(dirAbs));
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.type === "directory",
      }));
    },
    runGit: async (args, options) => {
      const result = await runEffect(
        execution.exec({
          command: buildGitShellCommand(args),
          cwd: root,
        }),
      );
      const code = result.exitCode;
      if (!options?.allowNonZeroExit && code !== 0) {
        return { code, stdout: result.stdout, stderr: result.stderr };
      }
      return { code, stdout: result.stdout, stderr: result.stderr };
    },
  };
};

export const resolveContextWorkspaceAccess = (
  workspaceRoot: string,
): Effect.Effect<
  ContextWorkspaceAccess,
  ResolveWorkspaceExecutionByCwdError,
  ProjectionSnapshotQuery | WorkspaceExecutionResolver
> =>
  Effect.gen(function* () {
    const executionOption = yield* resolveWorkspaceExecutionByCwd(workspaceRoot);
    if (Option.isSome(executionOption)) {
      return createSshContextWorkspaceAccess(workspaceRoot, executionOption.value);
    }
    return createLocalContextWorkspaceAccess(workspaceRoot);
  });

export const contextAccessOrLocal = (
  workspaceRoot: string,
  access?: ContextWorkspaceAccess,
): ContextWorkspaceAccess => access ?? createLocalContextWorkspaceAccess(workspaceRoot);

export { toPosixRelFromAccess };
