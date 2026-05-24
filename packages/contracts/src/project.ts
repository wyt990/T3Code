import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

// ─── 文件浏览器 ───

export const ProjectDirectoryEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  fullPath: TrimmedNonEmptyString,
  type: Schema.Literals(["file", "directory", "symlink", "other"]),
});
export type ProjectDirectoryEntry = typeof ProjectDirectoryEntry.Type;

// readFile
export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  contents: Schema.String,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

// listDirectory
export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  entries: Schema.Array(ProjectDirectoryEntry),
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export class ProjectListDirectoryError extends Schema.TaggedErrorClass<ProjectListDirectoryError>()(
  "ProjectListDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

// fileStat
export const ProjectFileStatInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
});
export type ProjectFileStatInput = typeof ProjectFileStatInput.Type;

export const ProjectFileStatResult = Schema.Struct({
  size: Schema.Number,
  isDirectory: Schema.Boolean,
  isFile: Schema.Boolean,
  isSymlink: Schema.Boolean,
});
export type ProjectFileStatResult = typeof ProjectFileStatResult.Type;

export class ProjectFileStatError extends Schema.TaggedErrorClass<ProjectFileStatError>()(
  "ProjectFileStatError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

// createDirectory
export const ProjectCreateDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
});
export type ProjectCreateDirectoryInput = typeof ProjectCreateDirectoryInput.Type;

// deleteFile
export const ProjectDeleteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  recursive: Schema.optional(Schema.Boolean),
});
export type ProjectDeleteFileInput = typeof ProjectDeleteFileInput.Type;

// renameFile
export const ProjectRenameFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  fromPath: TrimmedNonEmptyString,
  toPath: TrimmedNonEmptyString,
});
export type ProjectRenameFileInput = typeof ProjectRenameFileInput.Type;

export const ProjectRenameFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectRenameFileResult = typeof ProjectRenameFileResult.Type;
