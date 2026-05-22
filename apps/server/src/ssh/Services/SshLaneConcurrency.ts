import { Context } from "effect";
import type { Effect } from "effect";

import type { SshConnectionLane } from "../sshConnectionLane.ts";

export interface SshLaneConcurrencyShape {
  readonly withLanePermit: <A, E, R>(
    connectionId: string,
    lane: SshConnectionLane,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export class SshLaneConcurrency extends Context.Service<
  SshLaneConcurrency,
  SshLaneConcurrencyShape
>()("t3/ssh/Services/SshLaneConcurrency") {}
