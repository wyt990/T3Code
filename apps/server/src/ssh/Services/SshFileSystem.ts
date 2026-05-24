import { Context } from "effect";
import type { Effect } from "effect";

import type { SshError } from "../Errors.ts";
import type { SshConnectionLane } from "../sshConnectionLane.ts";
import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileStat,
} from "../../workspace/Services/WorkspaceExecution.ts";

export interface SshFileSystemShape {
  readonly list: (input: {
    readonly connectionId: string;
    readonly path: string;
    readonly lane?: SshConnectionLane;
  }) => Effect.Effect<ReadonlyArray<WorkspaceDirectoryEntry>, SshError>;

  readonly stat: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<WorkspaceFileStat, SshError>;

  readonly readFileString: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<string, SshError>;

  readonly readFileBytes: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<Uint8Array, SshError>;

  readonly writeFileString: (input: {
    readonly connectionId: string;
    readonly path: string;
    readonly contents: string;
  }) => Effect.Effect<void, SshError>;

  readonly makeDirectory: (input: {
    readonly connectionId: string;
    readonly path: string;
    readonly recursive?: boolean;
  }) => Effect.Effect<void, SshError>;

  readonly unlink: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<void, SshError>;

  readonly rmdir: (input: {
    readonly connectionId: string;
    readonly path: string;
  }) => Effect.Effect<void, SshError>;

  readonly rename: (input: {
    readonly connectionId: string;
    readonly fromPath: string;
    readonly toPath: string;
  }) => Effect.Effect<void, SshError>;
}

export class SshFileSystem extends Context.Service<SshFileSystem, SshFileSystemShape>()(
  "t3/ssh/Services/SshFileSystem",
) {}
