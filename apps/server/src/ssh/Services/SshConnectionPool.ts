import { Context } from "effect";
import type { Effect } from "effect";

import type { SshError } from "../Errors.ts";
import type { Ssh2Client } from "../ssh2Adapter.ts";
import type { SshConnectionLane } from "../sshConnectionLane.ts";

export interface SshConnectionAcquireOptions {
  readonly lane?: SshConnectionLane;
}

export interface SshConnectionLease {
  readonly connectionId: string;
  readonly lane: SshConnectionLane;
  readonly pooledKey: string;
  readonly client: Ssh2Client;
  readonly release: () => Effect.Effect<void>;
}

export interface SshConnectionPoolShape {
  readonly acquire: (
    connectionId: string,
    options?: SshConnectionAcquireOptions,
  ) => Effect.Effect<SshConnectionLease, SshError>;

  /** Closes every lane (git, probe, interactive, workspace) for this connection id. */
  readonly invalidate: (connectionId: string) => Effect.Effect<void>;
}

export class SshConnectionPool extends Context.Service<SshConnectionPool, SshConnectionPoolShape>()(
  "t3/ssh/Services/SshConnectionPool",
) {}
