import { Context, type Effect } from "effect";

export interface SshTurnStartGateShape {
  readonly withExclusive: <A, E, R>(
    connectionId: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly invalidate: (connectionId: string) => Effect.Effect<void>;
}

export class SshTurnStartGate extends Context.Service<SshTurnStartGate, SshTurnStartGateShape>()(
  "t3/ssh/Services/SshTurnStartGate",
) {}

export const sshConnectionIdForProject = (
  project:
    | {
        readonly transport: { readonly type: string; readonly sshConnectionId?: string };
      }
    | undefined,
): string | undefined =>
  project?.transport.type === "ssh" && project.transport.sshConnectionId !== undefined
    ? project.transport.sshConnectionId
    : undefined;
