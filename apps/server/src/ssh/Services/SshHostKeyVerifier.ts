import { Context } from "effect";
import type { Effect } from "effect";

import type { SshHostKeyUnknownError, SshHostKeyUntrustedError } from "../Errors.ts";

export interface SshHostKeyVerifierShape {
  readonly fingerprintForHost: (input: {
    readonly host: string;
    readonly port: number;
  }) => string | undefined;

  readonly verifyHostKey: (input: {
    readonly host: string;
    readonly port: number;
    readonly hostKey: Buffer;
  }) => Effect.Effect<void, SshHostKeyUnknownError | SshHostKeyUntrustedError>;

  readonly recordTrustedHost: (input: {
    readonly host: string;
    readonly port: number;
    readonly fingerprint: string;
  }) => Effect.Effect<void>;
}

export class SshHostKeyVerifier extends Context.Service<
  SshHostKeyVerifier,
  SshHostKeyVerifierShape
>()("t3/ssh/Services/SshHostKeyVerifier") {}
