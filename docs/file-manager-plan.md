# 文件管理器 — 开发方案 (v3 — 开发级)

## 概述

在 T3 Code 现有布局系统中集成文件管理功能，作为右侧可切换面板，支持文件树浏览、文件查看、文件编辑和文件操作（创建/重命名/删除）。

---

## 0. 修改总览

| 操作     | 文件                                                                   | 说明                                        |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| **新增** | `packages/contracts/src/project.ts`                                    | +6 组 Schema（Input/Result/Error），~120 行 |
| **修改** | `packages/contracts/src/rpc.ts`                                        | +6 WS_METHODS + Rpc.make + WsRpcGroup 条目  |
| **修改** | `apps/server/src/workspace/Services/WorkspaceFileSystem.ts`            | 接口扩展 +6 方法                            |
| **修改** | `apps/server/src/workspace/Layers/WorkspaceFileSystem.ts`              | 实现新增 6 方法                             |
| **修改** | `apps/server/src/ssh/Services/SshFileSystem.ts`                        | 接口扩展 +3 方法（unlink/rmdir/rename）     |
| **修改** | `apps/server/src/ssh/Layers/SshFileSystem.ts`                          | SFTP 实现新增 3 方法                        |
| **修改** | `apps/server/src/ws.ts`                                                | +6 个 RPC handler（observeRpcEffect 模式）  |
| **新增** | `apps/web/src/components/fileExplorer/FileExplorerPanelLayoutSlot.tsx` | LayoutSlot 包装器                           |
| **新增** | `apps/web/src/components/fileExplorer/FileExplorerPanel.tsx`           | 面板主组件                                  |
| **新增** | `apps/web/src/components/fileExplorer/FileTree.tsx`                    | 文件树                                      |
| **新增** | `apps/web/src/components/fileExplorer/FileTabs.tsx`                    | 文件标签栏                                  |
| **新增** | `apps/web/src/components/fileExplorer/FileEditor.tsx`                  | CodeMirror 6 查看+编辑                      |
| **新增** | `apps/web/src/components/fileExplorer/fileExplorerStore.ts`            | Zustand 状态管理                            |
| **修改** | `apps/web/src/layout/PanelRenderer.tsx`                                | PANEL_COMPONENTS + fileExplorer 条目        |
| **修改** | `apps/web/src/layout/layoutStore.ts`                                   | 预设模板 + fileExplorer 面板配置            |
| **修改** | `apps/web/package.json`                                                | +CodeMirror 6 依赖                          |

**Phase 总览：**

- Phase 1（后端）：10 个文件修改/新增
- Phase 2+3（前端）：10 个文件新增/修改
- Phase 4（完善）：不涉及新文件

---

## Phase 1 — 后端 RPC + Service

### 1.1 `packages/contracts/src/project.ts` — 新增 Schema

**操作：** 在文件末尾（现有 56 行后）追加以下内容。

需要注意的模式约束：

- Schema 使用 `Schema.Struct`、`Schema.Literals`、`Schema.Array`、`Schema.optional`、`Schema.String`、`Schema.Number`、`Schema.Boolean`
- 路径字段用 `TrimmedNonEmptyString`
- 错误类继承 `Schema.TaggedErrorClass`，必须有 `message` 和 `cause` 字段

```typescript
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
```

**验证：** `cd packages/contracts && bun run typecheck`

---

### 1.2 `packages/contracts/src/rpc.ts` — 注册 RPC

**操作 A：** 在现有 imports 区域（第 64-71 行）追加新导入：

```typescript
// 追加在第 71 行之后
import {
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectReadFileError,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectListDirectoryError,
  ProjectFileStatInput,
  ProjectFileStatResult,
  ProjectFileStatError,
  ProjectCreateDirectoryInput,
  ProjectDeleteFileInput,
  ProjectRenameFileInput,
  ProjectRenameFileResult,
} from "./project.ts";
```

**操作 B：** 在 `WS_METHODS` 对象（第 154-278 行）内，第 160 行 `projectsWriteFile` 之后追加：

```typescript
// 在第 160 行 projectsWriteFile 之后插入
projectsReadFile: "projects.readFile",
projectsListDirectory: "projects.listDirectory",
projectsFileStat: "projects.fileStat",
projectsCreateDirectory: "projects.createDirectory",
projectsDeleteFile: "projects.deleteFile",
projectsRenameFile: "projects.renameFile",
```

**操作 C：** 在现有 Rpc.make 条目（第 376-380 行 `WsProjectsWriteFileRpc`）之后追加：

```typescript
export const WsProjectsReadFileRpc = Rpc.make(WS_METHODS.projectsReadFile, {
  payload: ProjectReadFileInput,
  success: ProjectReadFileResult,
  error: ProjectReadFileError,
});

export const WsProjectsListDirectoryRpc = Rpc.make(WS_METHODS.projectsListDirectory, {
  payload: ProjectListDirectoryInput,
  success: ProjectListDirectoryResult,
  error: ProjectListDirectoryError,
});

export const WsProjectsFileStatRpc = Rpc.make(WS_METHODS.projectsFileStat, {
  payload: ProjectFileStatInput,
  success: ProjectFileStatResult,
  error: ProjectFileStatError,
});

export const WsProjectsCreateDirectoryRpc = Rpc.make(WS_METHODS.projectsCreateDirectory, {
  payload: ProjectCreateDirectoryInput,
});

export const WsProjectsDeleteFileRpc = Rpc.make(WS_METHODS.projectsDeleteFile, {
  payload: ProjectDeleteFileInput,
});

export const WsProjectsRenameFileRpc = Rpc.make(WS_METHODS.projectsRenameFile, {
  payload: ProjectRenameFileInput,
  success: ProjectRenameFileResult,
});
```

**操作 D：** 在 `WsRpcGroup`（第 943-1050 行）中，第 952 行 `WsProjectsWriteFileRpc` 之后追加：

```typescript
WsProjectsReadFileRpc,
WsProjectsListDirectoryRpc,
WsProjectsFileStatRpc,
WsProjectsCreateDirectoryRpc,
WsProjectsDeleteFileRpc,
WsProjectsRenameFileRpc,
```

**验证：** `cd packages/contracts && bun run typecheck`

---

### 1.3 `apps/server/src/workspace/Services/WorkspaceFileSystem.ts` — 扩展接口

**操作：** 在 `writeFile` 方法定义后（第 41 行附近）插入新方法签名。

完整文件修改后：

```typescript
// ...现有 imports 保持不变...

// 新增内部输入类型（不与 contracts 共享，因为 cwd 和 relativePath 在层内已分离）
interface ReadFileInput {
  readonly cwd: string;
  readonly relativePath: string;
}

interface ListDirInput {
  readonly cwd: string;
  readonly relativePath: string;
}

interface StatInput {
  readonly cwd: string;
  readonly relativePath: string;
}

interface CreateDirInput {
  readonly cwd: string;
  readonly relativePath: string;
}

interface DeleteFileInput {
  readonly cwd: string;
  readonly relativePath: string;
  readonly recursive?: boolean;
}

interface RenameFileInput {
  readonly cwd: string;
  readonly fromPath: string;
  readonly toPath: string;
}

export interface WorkspaceFileSystemShape {
  readonly writeFile: (
    input: ProjectWriteFileInput,
  ) => Effect.Effect<
    ProjectWriteFileResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  // 新增 ↓
  readonly readFile: (
    input: ReadFileInput,
  ) => Effect.Effect<string, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;

  readonly listDirectory: (
    input: ListDirInput,
  ) => Effect.Effect<
    ReadonlyArray<WorkspaceDirectoryEntry>,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  readonly stat: (
    input: StatInput,
  ) => Effect.Effect<WorkspaceFileStat, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;

  readonly createDirectory: (
    input: CreateDirInput,
  ) => Effect.Effect<void, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;

  readonly deleteFile: (
    input: DeleteFileInput,
  ) => Effect.Effect<void, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;

  readonly renameFile: (
    input: RenameFileInput,
  ) => Effect.Effect<string, WorkspaceFileSystemError | WorkspacePathOutsideRootError>;
}

// WorkspaceFileSystem Tag 保持原样
export class WorkspaceFileSystemError extends Schema.TaggedErrorClass<WorkspaceFileSystemError>()(
  "WorkspaceFileSystemError",
  {
    cwd: Schema.String,
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class WorkspaceFileSystem extends Context.Tag("WorkspaceFileSystem")<
  WorkspaceFileSystem,
  WorkspaceFileSystemShape
>() {}
```

新增 imports（需要追加在文件头）：

```typescript
import { WorkspaceDirectoryEntry, WorkspaceFileStat } from "./WorkspaceExecution.ts";
```

**验证：** `cd apps/server && bun run typecheck`

---

### 1.4 `apps/server/src/workspace/Layers/WorkspaceFileSystem.ts` — 实现层

**操作：** 在 `writeFile` 方法实现后，`return { writeFile }` 语句前，追加 6 个新方法的实现。

现有实现结构（第 15-114 行）：

```
makeWorkspaceFileSystem = Effect.gen(function* () {
  // 获取依赖
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  // writeFile 实现
  const writeFile = Effect.fn("WorkspaceFileSystem.writeFile")(function* (input) {
    const sshExecutionOption = yield* resolveWorkspaceExecutionByCwd(input.cwd);
    if (Option.isSome(sshExecutionOption)) {
      // SSH 分支
      ...
    } else {
      // 本地分支
      ...
    }
  });

  // 追加：readFile 实现
  const readFile = Effect.fn("WorkspaceFileSystem.readFile")(function* (input) {
    const sshExecutionOption = yield* resolveWorkspaceExecutionByCwd(input.cwd);
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      return yield* execution.fileSystem.readFileString(target.absolutePath);
    }
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    return yield* fileSystem.readFileString(target.absolutePath);
  });

  // listDirectory 实现
  const listDirectory = Effect.fn("WorkspaceFileSystem.listDirectory")(function* (input) {
    const sshExecutionOption = yield* resolveWorkspaceExecutionByCwd(input.cwd);
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      return yield* execution.fileSystem.list(target.absolutePath);
    }
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    return yield* fileSystem.list(target.absolutePath);
  });

  // stat 实现（SSH stat 已存在）
  const stat = Effect.fn("WorkspaceFileSystem.stat")(function* (input) {
    const sshExecutionOption = yield* resolveWorkspaceExecutionByCwd(input.cwd);
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      return yield* execution.fileSystem.stat(target.absolutePath);
    }
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    return yield* fileSystem.stat(target.absolutePath);
  });

  // createDirectory 实现
  const createDirectory = Effect.fn("WorkspaceFileSystem.createDirectory")(function* (input) {
    const sshExecutionOption = yield* resolveWorkspaceExecutionByCwd(input.cwd);
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      return yield* execution.fileSystem.makeDirectory(target.absolutePath, { recursive: true });
    }
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });
    return yield* fileSystem.makeDirectory(target.absolutePath, { recursive: true });
  });

  // deleteFile 实现
  const deleteFile = Effect.fn("WorkspaceFileSystem.deleteFile")(function* (input) {
    const sshExecutionOption = yield* resolveWorkspaceExecutionByCwd(input.cwd);
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      const target = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      // SSH: 先用 stat 检查类型，决定用 unlink 还是 rmdir
      const stat = yield* execution.fileSystem.stat(target.absolutePath);
      if (stat.isDirectory) {
        yield* execution.fileSystem.rmdir(target.absolutePath);
      } else {
        yield* execution.fileSystem.unlink(target.absolutePath);
      }
    } else {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });
      // 本地用 Effect FileSystem，支持 recursive
      yield* fileSystem.remove(target.absolutePath, { recursive: input.recursive ?? false });
    }
    // 使缓存失效
    yield* workspaceEntries.invalidate(input.cwd);
  });

  // renameFile 实现
  const renameFile = Effect.fn("WorkspaceFileSystem.renameFile")(function* (input) {
    const sshExecutionOption = yield* resolveWorkspaceExecutionByCwd(input.cwd);
    if (Option.isSome(sshExecutionOption)) {
      const execution = sshExecutionOption.value;
      // 注意：两个路径都需要在工作区根内验证
      const fromTarget = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.fromPath,
      });
      const toTarget = yield* workspacePaths.resolveRelativePathWithinPosixRoot({
        workspaceRoot: input.cwd,
        relativePath: input.toPath,
      });
      yield* execution.fileSystem.rename(fromTarget.absolutePath, toTarget.absolutePath);
    } else {
      const fromTarget = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.fromPath,
      });
      const toTarget = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.toPath,
      });
      yield* fileSystem.rename(fromTarget.absolutePath, toTarget.absolutePath);
    }
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: input.toPath };
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
```

**注意事项：**

- `readFile` / `listDirectory` / `stat` 不需要 `invalidate`（只读操作）
- `createDirectory` / `deleteFile` / `renameFile` 需要 `invalidate`
- 本地删除使用 `fileSystem.remove()`（Effect 的 FileSystem 支持 `recursive`）
- SSH 删除需要根据 stat 结果选择 `unlink`（文件）或 `rmdir`（目录）
- 本地 `makeDirectory` 直接在 `Path` 上操作（Effect 的 FileSystem 没有 `mkdirp`，但 `makeDirectory` 接受 `recursive` 选项）

**验证：** `cd apps/server && bun run typecheck`

---

### 1.5 `apps/server/src/ssh/Services/SshFileSystem.ts` — 扩展 SSH 接口

**操作：** 在现有 `makeDirectory` 方法定义后（第 43 行）追加：

```typescript
// 在 makeDirectory 定义后追加
readonly unlink: (input: {
  readonly connectionId: string;
  readonly path: string;
}) => Effect.Effect<void, SshFileSystemError>;

readonly rmdir: (input: {
  readonly connectionId: string;
  readonly path: string;
}) => Effect.Effect<void, SshFileSystemError>;

readonly rename: (input: {
  readonly connectionId: string;
  readonly fromPath: string;
  readonly toPath: string;
}) => Effect.Effect<void, SshFileSystemError>;
```

**完整新文件内容（49 → 70 行）：**

```typescript
import { Context, Effect, Schema } from "effect";
import type { SshConnectionLane } from "../SshConnectionPool.ts";
import { SshFileSystemError } from "../Errors.ts";

export interface SshFileSystemShape {
  readonly list: (input: {
    readonly connectionId: string;
    readonly path: string;
    readonly lane?: SshConnectionLane;
  }) => Effect.Effect<
    ReadonlyArray<import("../../workspace/Services/WorkspaceExecution.ts").WorkspaceDirectoryEntry>,
    SshFileSystemError
  >;

  readonly stat: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<
    import("../../workspace/Services/WorkspaceExecution.ts").WorkspaceFileStat,
    SshFileSystemError
  >;

  readonly readFileString: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<string, SshFileSystemError>;

  readonly readFileBytes: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<Uint8Array, SshFileSystemError>;

  readonly writeFileString: (input: {
    readonly connectionId: string;
    readonly path: string;
    readonly contents: string;
  }) => Effect.Effect<void, SshFileSystemError>;

  readonly makeDirectory: (input: {
    readonly connectionId: string;
    readonly path: string;
    readonly recursive?: boolean;
  }) => Effect.Effect<void, SshFileSystemError>;

  // 新增
  readonly unlink: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<void, SshFileSystemError>;

  readonly rmdir: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<void, SshFileSystemError>;

  readonly rename: (input: {
    readonly connectionId: string;
    readonly fromPath: string;
    readonly toPath: string;
  }) => Effect.Effect<void, SshFileSystemError>;
}

export class SshFileSystem extends Context.Tag("SshFileSystem")<
  SshFileSystem,
  SshFileSystemShape
>() {}
```

**验证：** `cd apps/server && bun run typecheck`

---

### 1.6 `apps/server/src/ssh/Layers/SshFileSystem.ts` — SFTP 实现

**操作：** 在 `return { ... }` 语句前（第 290 行前）追加 3 个方法实现，并在 return 对象中添加。

```typescript
// 在 makeDirectory 实现后、return 语句之前追加：

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

// return 对象追加：
return {
  list,
  stat,
  readFileString,
  readFileBytes,
  writeFileString,
  makeDirectory,
  unlink, // 新增
  rmdir, // 新增
  rename, // 新增
} satisfies (typeof SshFileSystem)["Service"];
```

**注意：** `sftp.unlink`、`sftp.rmdir`、`sftp.rename` 都是 `ssh2` 的 `SFTPWrapper` 原生方法，不需要额外依赖。

**验证：** `cd apps/server && bun run typecheck`

---

### 1.7 `apps/server/src/ws.ts` — RPC Handler

**操作 A：** 在现有导入区域（第 91 行附近）追加新导入：

```typescript
// 在 workspaceFileSystem 导入旁追加
import {
  ProjectReadFileError,
  ProjectListDirectoryError,
  ProjectFileStatError,
  ProjectReadFileInput,
  ProjectListDirectoryInput,
  ProjectFileStatInput,
  ProjectCreateDirectoryInput,
  ProjectDeleteFileInput,
  ProjectRenameFileInput,
} from "@t3tools/contracts";
```

**操作 B：** 在 `projectsWriteFile` handler（第 1804-1819 行）之后追加 6 个新 handler。所有 handler 都注册在同一个 RPC 处理器对象内（`WS_METHODS` 映射）。

```typescript
// 第 1819 行 projectsWriteFile 结束后追加：

[WS_METHODS.projectsReadFile]: (input) =>
  observeRpcEffect(
    WS_METHODS.projectsReadFile,
    workspaceFileSystem.readFile(input).pipe(
      Effect.mapError((cause) => {
        const message = Schema.is(WorkspacePathOutsideRootError)(cause)
          ? "File path must stay within the project root."
          : "Failed to read workspace file";
        return new ProjectReadFileError({ message, cause });
      }),
    ),
    { "rpc.aggregate": "workspace" },
  ),

[WS_METHODS.projectsListDirectory]: (input) =>
  observeRpcEffect(
    WS_METHODS.projectsListDirectory,
    workspaceFileSystem.listDirectory(input).pipe(
      Effect.mapError((cause) => {
        const message = Schema.is(WorkspacePathOutsideRootError)(cause)
          ? "Directory path must stay within the project root."
          : "Failed to list workspace directory";
        return new ProjectListDirectoryError({ message, cause });
      }),
    ),
    { "rpc.aggregate": "workspace" },
  ),

[WS_METHODS.projectsFileStat]: (input) =>
  observeRpcEffect(
    WS_METHODS.projectsFileStat,
    workspaceFileSystem.stat(input).pipe(
      Effect.mapError((cause) => {
        const message = Schema.is(WorkspacePathOutsideRootError)(cause)
          ? "File path must stay within the project root."
          : "Failed to stat workspace file";
        return new ProjectFileStatError({ message, cause });
      }),
    ),
    { "rpc.aggregate": "workspace" },
  ),

[WS_METHODS.projectsCreateDirectory]: (input) =>
  observeRpcEffect(
    WS_METHODS.projectsCreateDirectory,
    workspaceFileSystem.createDirectory(input).pipe(
      Effect.catchAll((cause) =>
        Effect.succeed(void 0 as never)  // 静默成功，不需要返回值
      ),
    ),
    { "rpc.aggregate": "workspace" },
  ),

[WS_METHODS.projectsDeleteFile]: (input) =>
  observeRpcEffect(
    WS_METHODS.projectsDeleteFile,
    workspaceFileSystem.deleteFile(input).pipe(
      Effect.catchAll((cause) =>
        Effect.succeed(void 0 as never)
      ),
    ),
    { "rpc.aggregate": "workspace" },
  ),

[WS_METHODS.projectsRenameFile]: (input) =>
  observeRpcEffect(
    WS_METHODS.projectsRenameFile,
    workspaceFileSystem.renameFile(input).pipe(
      Effect.mapError((cause) => {
        const message = "Failed to rename workspace file";
        return new ProjectReadFileError({ message, cause });  // 复用通用错误
      }),
    ),
    { "rpc.aggregate": "workspace" },
  ),
```

**注意：** `createDirectory` 和 `deleteFile` 用 `Effect.catchAll` 静默处理错误（操作类调用不返回复杂结果）。`renameFile` 返回新的 relativePath。

**验证：** `cd apps/server && bun run typecheck`

---

### 1.8 Phase 1 验证清单

```bash
# 1. 检查 contracts 编译
cd packages/contracts && bun run build

# 2. 检查 server 编译
cd apps/server && bun run typecheck

# 3. 完整构建
cd ../.. && bun run build

# 4. 手动测试 RPC（启动 dev 后通过 WebSocket 调用）
bun run dev:server
# 用 wscat 或浏览器 devtools 测试：
# {"method":"projects.listDirectory","params":{"cwd":"/path/to/project","relativePath":"."}}
# {"method":"projects.readFile","params":{"cwd":"/path/to/project","relativePath":"src/index.ts"}}
```

---

## Phase 2 — 前端文件树面板

### 2.1 新增依赖

在 `apps/web/` 目录执行：

```bash
cd apps/web && bun add @codemirror/view @codemirror/state @codemirror/language \
  @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-markdown \
  @codemirror/lang-css @codemirror/lang-html @codemirror/lang-python \
  @codemirror/lang-rust @codemirror/lang-go @codemirror/lang-xml \
  @codemirror/commands @codemirror/theme-one-dark
```

**依赖冲突检查：**

- 项目中不存在任何 `@codemirror/*` 或 `@lezer/*` 的间接依赖（已验证）
- CodeMirror 6 与 Lexical（现有富文本编辑器）属于不同的编辑器生态，无共享依赖
- CodeMirror 6 与 Shiki（`@pierre/diffs`）不共享包依赖，仅功能重叠

**注意：** 建议先只安装 `@codemirror/view` + `@codemirror/state` + `@codemirror/language` + `@codemirror/theme-one-dark` + `@codemirror/commands` + 最常用的语言包（javascript/typescript/json/markdown），其他语言包按需增量添加。

---

### 2.2 `fileExplorerStore.ts` — 状态管理

**文件：** `apps/web/src/components/fileExplorer/fileExplorerStore.ts`

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OpenFile {
  readonly path: string;
  readonly name: string;
  readonly isDirty: boolean;
}

interface FileExplorerState {
  // 展开的目录路径
  expandedPaths: Record<string, boolean>;
  // 已打开的文件
  openFiles: OpenFile[];
  // 当前激活的文件路径
  activeFilePath: string | null;
  // 文件内容缓存
  fileContents: Record<string, string>;
}

interface FileExplorerActions {
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  openFile: (path: string, name: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  setFileContents: (path: string, contents: string) => void;
  setFileDirty: (path: string, dirty: boolean) => void;
  updateFileContents: (path: string, contents: string) => void;
}

export const useFileExplorerStore = create<FileExplorerState & FileExplorerActions>()(
  persist(
    (set) => ({
      // 初始状态
      expandedPaths: {},
      openFiles: [],
      activeFilePath: null,
      fileContents: {},

      // Actions
      toggleExpanded: (path) =>
        set((s) => ({
          expandedPaths: { ...s.expandedPaths, [path]: !s.expandedPaths[path] },
        })),
      setExpanded: (path, expanded) =>
        set((s) => ({
          expandedPaths: { ...s.expandedPaths, [path]: expanded },
        })),
      openFile: (path, name) =>
        set((s) => {
          if (s.openFiles.some((f) => f.path === path)) {
            return { activeFilePath: path };
          }
          return {
            openFiles: [...s.openFiles, { path, name, isDirty: false }],
            activeFilePath: path,
          };
        }),
      closeFile: (path) =>
        set((s) => {
          const idx = s.openFiles.findIndex((f) => f.path === path);
          const newFiles = s.openFiles.filter((f) => f.path !== path);
          let newActive = s.activeFilePath;
          if (s.activeFilePath === path) {
            // 激活相邻文件
            if (newFiles.length === 0) {
              newActive = null;
            } else if (idx > 0) {
              newActive = newFiles[idx - 1].path;
            } else {
              newActive = newFiles[0].path;
            }
          }
          return { openFiles: newFiles, activeFilePath: newActive };
        }),
      setActiveFile: (path) => set({ activeFilePath: path }),
      setFileContents: (path, contents) =>
        set((s) => ({
          fileContents: { ...s.fileContents, [path]: contents },
        })),
      setFileDirty: (path, dirty) =>
        set((s) => ({
          openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, isDirty: dirty } : f)),
        })),
      updateFileContents: (path, contents) =>
        set((s) => ({
          fileContents: { ...s.fileContents, [path]: contents },
        })),
    }),
    {
      name: "t3-file-explorer",
      partialize: (state) => ({
        expandedPaths: state.expandedPaths,
        openFiles: state.openFiles.map(({ path, name }) => ({ path, name, isDirty: false })),
        activeFilePath: state.activeFilePath,
      }),
    },
  ),
);
```

**持久化策略：** 只保存 `expandedPaths`、`openFiles`（不含 dirty 状态）、`activeFilePath`。不持久化 `fileContents`（重新读取）。

---

### 2.3 `FileTree.tsx` + `FileTreeNode.tsx` — 文件树

**FileTreeNode.tsx：**

```typescript
// apps/web/src/components/fileExplorer/FileTreeNode.tsx
import { useState } from "react";
import { cn } from "../../lib/utils";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";

interface FileTreeNodeProps {
  readonly name: string;
  readonly fullPath: string;
  readonly type: "file" | "directory" | "symlink" | "other";
  readonly depth: number;
  readonly isExpanded: boolean;
  readonly isSelected: boolean;
  readonly workspaceRoot: string;
  readonly onToggle: (path: string) => void;
  readonly onSelect: (path: string) => void;
}

export function FileTreeNode({
  name,
  fullPath,
  type,
  depth,
  isExpanded,
  isSelected,
  workspaceRoot,
  onToggle,
  onSelect,
}: FileTreeNodeProps) {
  const isDirectory = type === "directory";

  const handleClick = () => {
    if (isDirectory) {
      onToggle(fullPath);
    } else {
      onSelect(fullPath);
    }
  };

  return (
    <div
      className={cn(
        "file-tree-item flex items-center gap-1 px-2 py-0.5 text-sm cursor-pointer select-none",
        "hover:bg-white/5 rounded-sm",
        isSelected && "bg-accent/10 text-accent",
      )}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={handleClick}
    >
      {/* 展开箭头（仅目录） */}
      {isDirectory ? (
        <span className="w-4 text-center text-muted-foreground text-xs shrink-0">
          {isExpanded ? "▾" : "▸"}
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      {/* VS Code 风格图标 */}
      <VscodeEntryIcon
        pathValue={fullPath}
        kind={isDirectory ? "directory" : "file"}
        theme="dark"
        className="size-4 shrink-0"
      />
      {/* 文件名 */}
      <span className="truncate">{name}</span>
    </div>
  );
}
```

**FileTree.tsx：**

```typescript
// apps/web/src/components/fileExplorer/FileTree.tsx
import { useCallback } from "react";
import { useFileExplorerStore } from "./fileExplorerStore";
import { FileTreeNode } from "./FileTreeNode";
import type { ProjectDirectoryEntry } from "@t3tools/contracts";

// RPC 调用封装（通过 WebSocket）
async function listDirectory(cwd: string, relativePath: string): Promise<ProjectDirectoryEntry[]> {
  const api = readLocalApi();
  if (!api) return [];
  return api.rpc("projects.listDirectory", { cwd, relativePath }).then((r) => r.entries);
}

interface FileTreeProps {
  readonly workspaceRoot: string;
  readonly projectId: string;
}

export function FileTree({ workspaceRoot }: FileTreeProps) {
  const expandedPaths = useFileExplorerStore((s) => s.expandedPaths);
  const activeFilePath = useFileExplorerStore((s) => s.activeFilePath);
  const toggleExpanded = useFileExplorerStore((s) => s.toggleExpanded);
  const openFile = useFileExplorerStore((s) => s.openFile);
  const setFileContents = useFileExplorerStore((s) => s.setFileContents);

  // ...渲染逻辑

  return (
    <div className="py-1 text-sm">
      {/* 递归渲染文件树节点 */}
    </div>
  );
}
```

**注意：** 需要在组件中管理每个目录的子条目加载状态（loading/loaded/error），使用 React 本地状态 + `useEffect` 实现懒加载。

---

### 2.4 `FileExplorerPanelLayoutSlot.tsx` — 面板入口

```typescript
// apps/web/src/components/fileExplorer/FileExplorerPanelLayoutSlot.tsx
import { useWorkbenchContextBinding } from "../../contextAwareness/useWorkbenchContextBinding";
import { FileExplorerPanel } from "./FileExplorerPanel";

export function FileExplorerPanelLayoutSlot({ className }: { className?: string }) {
  const { projectId, workspaceRoot } = useWorkbenchContextBinding();

  // 没有活动项目时显示空状态
  if (!projectId || !workspaceRoot) {
    return (
      <div className={cn("flex items-center justify-center h-full text-muted-foreground text-sm", className)}>
        请先选择一个项目
      </div>
    );
  }

  return (
    <FileExplorerPanel
      projectId={projectId}
      workspaceRoot={workspaceRoot}
      className={className}
    />
  );
}
```

### 2.5 `FileExplorerPanel.tsx` — 面板主组件

```typescript
// apps/web/src/components/fileExplorer/FileExplorerPanel.tsx
import { FileTree } from "./FileTree";
import { FileTabs } from "./FileTabs";
import { FileEditor } from "./FileEditor";
import { useFileExplorerStore } from "./fileExplorerStore";

interface FileExplorerPanelProps {
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly className?: string;
}

export function FileExplorerPanel({ projectId, workspaceRoot, className }: FileExplorerPanelProps) {
  const activeFilePath = useFileExplorerStore((s) => s.activeFilePath);
  const openFiles = useFileExplorerStore((s) => s.openFiles);

  const showEditor = activeFilePath && openFiles.some((f) => f.path === activeFilePath);

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {showEditor ? (
        <>
          <FileTabs workspaceRoot={workspaceRoot} />
          <FileEditor
            key={activeFilePath}
            filePath={activeFilePath}
            workspaceRoot={workspaceRoot}
            className="flex-1 overflow-hidden"
          />
        </>
      ) : (
        <FileTree workspaceRoot={workspaceRoot} projectId={projectId} />
      )}
    </div>
  );
}
```

**注意：** `FileEditor` 用 `key={activeFilePath}` 确保切换文件时重新挂载（CodeMirror 实例重建）。

---

### 2.6 修改 `PanelRenderer.tsx`

**操作：** 在 `PANEL_COMPONENTS` 注册表（第 84-90 行）添加：

```typescript
import { FileExplorerPanelLayoutSlot } from "../components/fileExplorer/FileExplorerPanelLayoutSlot";

const PANEL_COMPONENTS: Record<string, ComponentType<{ className?: string }>> = {
  context: ContextPanelLayoutSlot,
  visualization: VisualizationPanelLayoutSlot,
  testing: TestCoveragePanel,
  environment: EnvironmentPanelLayoutSlot,
  multiAgent: MultiAgentPanelLayoutSlot,
  fileExplorer: FileExplorerPanelLayoutSlot, // 新增
};
```

### 2.7 修改 `layoutStore.ts`

**操作 A：** 在 `RAIL_QUICK_TOGGLE_PANEL_IDS`（第 25 行）添加 `"fileExplorer"`：

```typescript
export const RAIL_QUICK_TOGGLE_PANEL_IDS = new Set([
  "context",
  "environment",
  "multiAgent",
  "fileExplorer", // 新增
]);
```

**操作 B：** 在三个预设模板的右侧面板配置中（development 约第 100 行、debug 约第 150 行、review 约第 210 行），在 `multiAgent` 配置后添加：

```typescript
{
  id: "fileExplorer",
  title: "文件",
  visible: false,
  position: "right" as const,
  order: 3,
  collapsed: false,
  width: 100,
  height: 100,
},
```

**注意：** `fileExplorer` 不加 `railDocked` 字段，因为 `isDockPanelDisplayed` 会将其视为普通面板（仅在 `RAIL_QUICK_TOGGLE_PANEL_IDS` 中的面板需要 `railDocked`）。或者加入快速切换集后需要加 `railDocked`——根据期望的行为决定：

- 如果希望与其他面板一样（点击切换），不加 `railDocked`
- 如果希望像 context/environment 一样有标题栏快捷按钮，加 `railDocked` 并加入 `RAIL_QUICK_TOGGLE_PANEL_IDS`

**建议：** 先不加 `railDocked`，从 `RAIL_QUICK_TOGGLE_PANEL_IDS` 移除，保持简单。

---

## Phase 3 — 文件查看/编辑

### 3.1 `FileTabs.tsx`

```typescript
// apps/web/src/components/fileExplorer/FileTabs.tsx
import { useFileExplorerStore } from "./fileExplorerStore";
import { cn } from "../../lib/utils";

interface FileTabsProps {
  readonly workspaceRoot: string;
}

export function FileTabs({ workspaceRoot }: FileTabsProps) {
  const openFiles = useFileExplorerStore((s) => s.openFiles);
  const activeFilePath = useFileExplorerStore((s) => s.activeFilePath);
  const setActiveFile = useFileExplorerStore((s) => s.setActiveFile);
  const closeFile = useFileExplorerStore((s) => s.closeFile);

  return (
    <div className="flex items-center overflow-x-auto border-b border-border bg-panel-header shrink-0">
      {openFiles.map((file) => (
        <div
          key={file.path}
          className={cn(
            "flex items-center gap-1 px-3 py-1.5 text-xs border-r border-border cursor-pointer",
            "hover:bg-white/5 shrink-0",
            activeFilePath === file.path && "bg-white/10 border-b-2 border-b-accent",
          )}
          onClick={() => setActiveFile(file.path)}
        >
          <span>{file.name}</span>
          {file.isDirty && <span className="text-yellow-500">●</span>}
          <button
            className="ml-1 hover:text-foreground text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); closeFile(file.path); }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
```

### 3.2 `FileEditor.tsx` — CodeMirror 6 查看/编辑

```typescript
// apps/web/src/components/fileExplorer/FileEditor.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { xml } from "@codemirror/lang-xml";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { useFileExplorerStore } from "./fileExplorerStore";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";

// 语言检测映射
const EXTENSION_LANG: Record<string, (() => import("@codemirror/language").LanguageSupport) | null> = {
  ".ts": javascript,
  ".tsx": () => javascript({ jsx: true, typescript: true }),
  ".js": javascript,
  ".jsx": () => javascript({ jsx: true }),
  ".mjs": javascript,
  ".cjs": javascript,
  ".json": json,
  ".md": markdown,
  ".css": css,
  ".html": html,
  ".htm": html,
  ".py": python,
  ".rs": rust,
  ".go": go,
  ".xml": xml,
  ".svg": xml,
};

function detectLanguage(fileName: string) {
  const ext = fileName.substring(fileName.lastIndexOf("."));
  return EXTENSION_LANG[ext] ?? null;
}

interface FileEditorProps {
  readonly filePath: string;
  readonly workspaceRoot: string;
  readonly className?: string;
}

export function FileEditor({ filePath, workspaceRoot, className }: FileEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileContents = useFileExplorerStore((s) => s.fileContents[filePath]);
  const setFileContents = useFileExplorerStore((s) => s.setFileContents);
  const updateFileContents = useFileExplorerStore((s) => s.updateFileContents);
  const setFileDirty = useFileExplorerStore((s) => s.setFileDirty);

  // 读取文件
  useEffect(() => {
    if (!fileContents) {
      const api = readLocalApi();
      if (!api) return;
      api.rpc("projects.readFile", { cwd: workspaceRoot, relativePath: filePath })
        .then((result) => {
          setFileContents(filePath, result.contents);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [filePath, workspaceRoot]);

  // 初始化/更新 CodeMirror
  useEffect(() => {
    if (loading || !editorRef.current || !fileContents) return;

    const fileName = filePath.split("/").pop() ?? filePath;
    const langExt = detectLanguage(fileName);
    const isLargeFile = fileContents.length > 1024 * 1024; // >1MB

    const state = EditorState.create({
      doc: fileContents,
      extensions: [
        basicSetup,
        oneDark,
        keymap.of([indentWithTab]),
        // 大文件不启用语法高亮
        ...(isLargeFile ? [] : langExt ? [langExt()] : []),
        // 编辑状态控制
        EditorView.editable.of(isEditing),
        // 监听内容变化（仅编辑模式）
        ...(isEditing
          ? [EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                updateFileContents(filePath, update.state.doc.toString());
                setFileDirty(filePath, true);
              }
            })]
          : []),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => view.destroy();
  }, [filePath, loading, isEditing]);

  // Ctrl+S 保存
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEditing, fileContents]);

  const handleSave = useCallback(async () => {
    const api = readLocalApi();
    if (!api || !fileContents) return;
    await api.rpc("projects.writeFile", {
      cwd: workspaceRoot,
      relativePath: filePath,
      contents: fileContents,
    });
    setFileDirty(filePath, false);
  }, [filePath, workspaceRoot, fileContents]);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>;
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border shrink-0">
        <button
          className="text-xs px-2 py-0.5 rounded hover:bg-white/10"
          onClick={() => setIsEditing(!isEditing)}
        >
          {isEditing ? "完成编辑" : "编辑"}
        </button>
        {isEditing && (
          <button
            className="text-xs px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/80"
            onClick={handleSave}
          >
            保存
          </button>
        )}
      </div>
      {/* CodeMirror 容器 */}
      <div ref={editorRef} className="flex-1 overflow-auto" />
    </div>
  );
}
```

**关键设计点：**

- `basicSetup` 提供缩进、行号、括号匹配等基础功能
- `EditorView.editable.of(isEditing)` 控制查看/编辑切换
- 编辑模式下启用 `updateListener` 追踪内容变化
- 大文件（>1MB）禁用语法高亮，防止卡顿
- `indentWithTab` 快捷键（Tab 缩进）

---

### 3.3 Phase 2+3 验证清单

```bash
# 编译检查
cd apps/web && bun run typecheck

# Lint + Format
cd apps/web && bun run lint && bun run fmt

# 启动验证
cd apps/web && bun run dev:web
# 1. 打开项目 → 点击面板栏"文件"图标
# 2. 展开目录 → 检查懒加载
# 3. 点击文件 → 检查 CodeMirror 渲染
# 4. 切换编辑模式 → 修改 → Ctrl+S 保存
# 5. 关闭标签 → 检查 dirty 提醒
```

---

## 4. 修改顺序和依赖关系

```
Phase 1（后端，无前端依赖）：
  packages/contracts/src/project.ts    ← 无依赖，可最先修改
  packages/contracts/src/rpc.ts        ← 依赖 project.ts 中的 Schema
  apps/server/src/ssh/Services/SshFileSystem.ts  ← 无依赖
  apps/server/src/ssh/Layers/SshFileSystem.ts    ← 依赖 SSH 接口
  apps/server/src/workspace/Services/WorkspaceFileSystem.ts  ← 无依赖
  apps/server/src/workspace/Layers/WorkspaceFileSystem.ts    ← 依赖 Service 接口 + SSH
  apps/server/src/ws.ts                ← 依赖所有以上

Phase 2（前端，依赖 Phase 1 完成）：
  └── bun add @codemirror/*              ← 必须先执行
  apps/web/src/layout/layoutStore.ts     ← 无依赖
  apps/web/src/layout/PanelRenderer.tsx  ← 无依赖
  apps/web/src/components/fileExplorer/  ← 依赖 contracts（RPC 类型）

Phase 3（前端，依赖 Phase 2）：
  apps/web/src/components/fileExplorer/FileEditor.tsx  ← 依赖 CodeMirror + RPC
```

**构建验证顺序（推荐）：**

1. `cd packages/contracts && bun run build`
2. `cd apps/server && bun run typecheck`
3. `cd apps/web && bun run typecheck`
4. `cd .. && bun run build`（全量构建）
5. `bun run dev`（启动完整开发环境）

---

## 5. 风险检查清单

| 风险项       | 检查结论                 | 说明                                           |
| ------------ | ------------------------ | ---------------------------------------------- |
| 依赖冲突     | ✅ 无冲突                | 无现有 `@codemirror/*` 间接依赖                |
| 构建顺序     | ✅ 明确                  | contracts → server → web                       |
| 路径安全     | ✅ 复用 WorkspacePaths   | 所有路径操作经过 resolveRelativePathWithinRoot |
| SSH 兼容     | ✅ 扩展 SshFileSystem    | unlink/rmdir/rename 使用原生 SFTP API          |
| 缓存失效     | ✅ 复用 WorkspaceEntries | 写入/删除/重命名后 invalidate(cwd)             |
| 面板显示冲突 | ✅ 新 ID                 | fileExplorer ID 不存在于现有代码中             |
| bundle 体积  | ⚠️ 约 +200KB gzip        | CM6 是完整编辑器，属正常范围                   |
| 右侧面板宽度 | ⚠️ w-80 (320px)          | 编辑体验可能偏窄，可后续用 sheet 展开          |
| 大文件       | ⚠️ >1MB 禁用高亮         | 通过 fileContents.length 判断                  |
