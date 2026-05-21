/**
 * WorkspaceExecution - Per-project execution abstraction (local disk vs SSH).
 *
 * Provider, Git, terminal, and workspace file subsystems resolve an execution
 * instance by projectId via WorkspaceExecutionResolver.
 *
 * @module WorkspaceExecution
 */
import type { ProjectId } from "@t3tools/contracts";
import { Context, Schema } from "effect";
import type { Effect, Stream } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { SshError } from "../../ssh/Errors.ts";
import { formatSshError } from "../../ssh/formatSshUserMessage.ts";

export type WorkspaceExecutionKind = "local" | "ssh";

export const WorkspaceDirectoryEntryType = Schema.Literals([
  "file",
  "directory",
  "symlink",
  "other",
]);
export type WorkspaceDirectoryEntryType = typeof WorkspaceDirectoryEntryType.Type;

export interface WorkspaceDirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly type: WorkspaceDirectoryEntryType;
}

export interface WorkspaceFileStat {
  readonly path: string;
  readonly isDirectory: boolean;
  readonly size: number;
}

export interface WorkspaceExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface WorkspaceInteractiveProcess {
  readonly write: (data: string | Uint8Array) => Effect.Effect<void, WorkspaceExecutionError>;
  readonly stdout: Stream.Stream<string, WorkspaceExecutionError>;
  readonly stderr: Stream.Stream<string, WorkspaceExecutionError>;
  readonly exited: Effect.Effect<number, WorkspaceExecutionError>;
  readonly kill: (signal?: NodeJS.Signals) => Effect.Effect<void, WorkspaceExecutionError>;
}

export interface WorkspaceExecutionFileSystem {
  readonly list: (
    path: string,
  ) => Effect.Effect<ReadonlyArray<WorkspaceDirectoryEntry>, WorkspaceExecutionError>;

  readonly stat: (path: string) => Effect.Effect<WorkspaceFileStat, WorkspaceExecutionError>;

  readonly readFileString: (path: string) => Effect.Effect<string, WorkspaceExecutionError>;

  readonly readFileBytes: (path: string) => Effect.Effect<Uint8Array, WorkspaceExecutionError>;

  readonly writeFileString: (input: {
    readonly path: string;
    readonly contents: string;
  }) => Effect.Effect<void, WorkspaceExecutionError>;

  readonly makeDirectory: (
    path: string,
    options?: { readonly recursive?: boolean },
  ) => Effect.Effect<void, WorkspaceExecutionError>;
}

export interface WorkspaceTerminalSession {
  readonly write: (data: string) => Effect.Effect<void, WorkspaceExecutionError>;
  readonly resize: (cols: number, rows: number) => Effect.Effect<void, WorkspaceExecutionError>;
  readonly output: Stream.Stream<string, WorkspaceExecutionError>;
  readonly exited: Effect.Effect<number, WorkspaceExecutionError>;
  readonly close: () => Effect.Effect<void, WorkspaceExecutionError>;
}

export interface WorkspaceExecutionTerminal {
  readonly open: (input: {
    readonly cwd: string;
    readonly cols: number;
    readonly rows: number;
    readonly env?: Record<string, string | undefined>;
  }) => Effect.Effect<WorkspaceTerminalSession, WorkspaceExecutionError>;
}

export interface WorkspaceSpawnInteractiveInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string | undefined>;
  readonly signal?: AbortSignal;
}

export interface WorkspaceExecInput {
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly stdin?: string;
  /** SSH only: selects a dedicated pooled session (git / probe / interactive / workspace). */
  readonly sshLane?: "git" | "probe" | "interactive" | "workspace";
}

export interface WorkspaceExecution {
  readonly kind: WorkspaceExecutionKind;
  readonly workspaceRoot: string;
  readonly sshConnectionId?: string;
  readonly spawnInteractive: (
    input: WorkspaceSpawnInteractiveInput,
  ) => Effect.Effect<WorkspaceInteractiveProcess, WorkspaceExecutionError>;
  readonly exec: (
    input: WorkspaceExecInput,
  ) => Effect.Effect<WorkspaceExecResult, WorkspaceExecutionError>;
  readonly fileSystem: WorkspaceExecutionFileSystem;
  readonly terminal: WorkspaceExecutionTerminal;
}

export class WorkspaceExecutionProjectNotFoundError extends Schema.TaggedErrorClass<WorkspaceExecutionProjectNotFoundError>()(
  "WorkspaceExecutionProjectNotFoundError",
  {
    projectId: Schema.String,
  },
) {
  override get message(): string {
    return `Project not found for workspace execution: ${this.projectId}`;
  }
}

export class WorkspaceExecutionUnsupportedTransportError extends Schema.TaggedErrorClass<WorkspaceExecutionUnsupportedTransportError>()(
  "WorkspaceExecutionUnsupportedTransportError",
  {
    projectId: Schema.String,
    transportType: Schema.String,
  },
) {
  override get message(): string {
    return `Unsupported project transport for ${this.projectId}: ${this.transportType}`;
  }
}

export class WorkspaceExecutionError extends Schema.TaggedErrorClass<WorkspaceExecutionError>()(
  "WorkspaceExecutionError",
  {
    kind: Schema.Literals(["local", "ssh"]),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Workspace execution (${this.kind}) ${this.operation} failed: ${this.detail}`;
  }
}

export type WorkspaceExecutionResolverError =
  | WorkspaceExecutionProjectNotFoundError
  | WorkspaceExecutionUnsupportedTransportError
  | WorkspaceExecutionError
  | ProjectionRepositoryError
  | SshError;

export const toWorkspaceExecutionError = (
  kind: WorkspaceExecutionKind,
  operation: string,
  cause: unknown,
): WorkspaceExecutionError => {
  const detail =
    kind === "ssh" && Schema.is(SshError)(cause)
      ? formatSshError(cause)
      : cause instanceof WorkspaceExecutionError
        ? cause.detail
        : cause instanceof Error
          ? cause.message
          : String(cause);

  return new WorkspaceExecutionError({
    kind,
    operation,
    detail,
    cause,
  });
};

export interface WorkspaceExecutionResolverShape {
  readonly resolveByProjectId: (
    projectId: ProjectId,
  ) => Effect.Effect<WorkspaceExecution, WorkspaceExecutionResolverError>;
}

export class WorkspaceExecutionResolver extends Context.Service<
  WorkspaceExecutionResolver,
  WorkspaceExecutionResolverShape
>()("t3/workspace/Services/WorkspaceExecutionResolver") {}
