import { Context } from "effect";
import type { Effect } from "effect";

import type { SshError } from "../Errors.ts";
import type { SshConnectionLane } from "../sshConnectionLane.ts";

export interface SshPortForwardTarget {
  readonly remoteHost: string;
  readonly remotePort: number;
  readonly localHost?: string;
  readonly lane?: SshConnectionLane;
}

export interface SshPortForwardHandle {
  readonly localHost: string;
  readonly localPort: number;
  readonly localUrl: string;
  readonly release: () => Effect.Effect<void, SshError>;
}

export interface SshPortForwardShape {
  readonly acquireForward: (
    connectionId: string,
    target: SshPortForwardTarget,
  ) => Effect.Effect<SshPortForwardHandle, SshError>;
}

export class SshPortForward extends Context.Service<SshPortForward, SshPortForwardShape>()(
  "t3/ssh/Services/SshPortForward",
) {}
