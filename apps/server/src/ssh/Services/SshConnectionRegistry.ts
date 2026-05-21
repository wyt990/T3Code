import type {
  SshConnectionConfig,
  SshConnectionSummary,
  SshUpsertConnectionInput,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { SshConnectionNotFoundError } from "../Errors.ts";

export interface SshConnectionRegistryShape {
  readonly getById: (
    connectionId: string,
  ) => Effect.Effect<SshConnectionConfig, SshConnectionNotFoundError>;

  readonly list: () => Effect.Effect<ReadonlyArray<SshConnectionConfig>>;

  readonly upsert: (input: SshUpsertConnectionInput) => Effect.Effect<SshConnectionSummary, never>;

  readonly delete: (connectionId: string) => Effect.Effect<void, SshConnectionNotFoundError>;

  readonly recordConnectionResult: (input: {
    readonly connectionId: string;
    readonly ok: boolean;
    readonly error?: string;
  }) => Effect.Effect<void, SshConnectionNotFoundError>;
}

export class SshConnectionRegistry extends Context.Service<
  SshConnectionRegistry,
  SshConnectionRegistryShape
>()("t3/ssh/Services/SshConnectionRegistry") {}
