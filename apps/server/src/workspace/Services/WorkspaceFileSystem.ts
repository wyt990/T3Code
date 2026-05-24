/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";

import type { ProjectWriteFileInput, ProjectWriteFileResult } from "@t3tools/contracts";
import { WorkspacePathOutsideRootError } from "./WorkspacePaths.ts";
import type { WorkspaceDirectoryEntry, WorkspaceFileStat } from "./WorkspaceExecution.ts";

export class WorkspaceFileSystemError extends Schema.TaggedErrorClass<WorkspaceFileSystemError>()(
  "WorkspaceFileSystemError",
  {
    cwd: Schema.String,
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * WorkspaceFileSystemShape - Service API for workspace-relative file operations.
 */
export interface WorkspaceFileSystemShape {
  /**
   * Write a file relative to the workspace root.
   *
   * Creates parent directories as needed and rejects paths that escape the
   * workspace root.
   */
  readonly writeFile: (
    input: ProjectWriteFileInput,
  ) => Effect.Effect<
    ProjectWriteFileResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  readonly readFile: (input: {
    readonly cwd: string;
    readonly relativePath: string;
  }) => Effect.Effect<string, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;

  readonly listDirectory: (input: {
    readonly cwd: string;
    readonly relativePath: string;
  }) => Effect.Effect<
    ReadonlyArray<WorkspaceDirectoryEntry>,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  readonly stat: (input: {
    readonly cwd: string;
    readonly relativePath: string;
  }) => Effect.Effect<WorkspaceFileStat, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;

  readonly createDirectory: (input: {
    readonly cwd: string;
    readonly relativePath: string;
  }) => Effect.Effect<void, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;

  readonly deleteFile: (input: {
    readonly cwd: string;
    readonly relativePath: string;
    readonly recursive?: boolean;
  }) => Effect.Effect<void, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;

  readonly renameFile: (input: {
    readonly cwd: string;
    readonly fromPath: string;
    readonly toPath: string;
  }) => Effect.Effect<string, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;
}

/**
 * WorkspaceFileSystem - Service tag for workspace file operations.
 */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  WorkspaceFileSystemShape
>()("t3/workspace/Services/WorkspaceFileSystem") {}
