import { Context, Schema } from "effect";
import type { Effect } from "effect";

import { SshCredentialUnavailableError } from "../Errors.ts";

export const SshAuthMaterial = Schema.Struct({
  password: Schema.optional(Schema.String),
  privateKey: Schema.optional(Schema.String),
  passphrase: Schema.optional(Schema.String),
});
export type SshAuthMaterial = typeof SshAuthMaterial.Type;

export interface SshCredentialResolverShape {
  readonly resolve: (
    connectionId: string,
  ) => Effect.Effect<SshAuthMaterial, SshCredentialUnavailableError>;
}

export class SshCredentialResolver extends Context.Service<
  SshCredentialResolver,
  SshCredentialResolverShape
>()("t3/ssh/Services/SshCredentialResolver") {}
