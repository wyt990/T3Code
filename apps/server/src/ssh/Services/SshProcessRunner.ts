import { Context } from "effect";
import type { Effect } from "effect";

import type { SshError } from "../Errors.ts";
import type { SshConnectionLane } from "../sshConnectionLane.ts";
import type {
  WorkspaceExecResult,
  WorkspaceInteractiveProcess,
} from "../../workspace/Services/WorkspaceExecution.ts";

export interface SshExecInput {
  readonly connectionId: string;
  readonly lane?: SshConnectionLane;
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly stdin?: string;
}

export interface SshSpawnInteractiveInput {
  readonly connectionId: string;
  readonly lane?: SshConnectionLane;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Record<string, string | undefined>;
  readonly signal?: AbortSignal;
}

export interface SshProcessRunnerShape {
  readonly exec: (input: SshExecInput) => Effect.Effect<WorkspaceExecResult, SshError>;

  readonly spawnInteractive: (
    input: SshSpawnInteractiveInput,
  ) => Effect.Effect<WorkspaceInteractiveProcess, SshError>;
}

export class SshProcessRunner extends Context.Service<SshProcessRunner, SshProcessRunnerShape>()(
  "t3/ssh/Services/SshProcessRunner",
) {}
