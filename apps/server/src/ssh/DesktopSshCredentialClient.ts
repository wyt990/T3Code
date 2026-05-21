import { SshAuthSecrets } from "@t3tools/contracts";
import { Effect } from "effect";
import * as Schema from "effect/Schema";

import { SshCredentialUnavailableError } from "./Errors.ts";
import type { SshAuthMaterial } from "./Services/SshCredentialResolver.ts";

const decodeAuthSecrets = Schema.decodeUnknownEffect(SshAuthSecrets);

export const fetchDesktopSshAuthMaterial = (input: {
  readonly port: number;
  readonly bootstrapToken: string;
  readonly connectionId: string;
}): Effect.Effect<SshAuthMaterial, SshCredentialUnavailableError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`http://127.0.0.1:${input.port}/v1/ssh/credential`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.bootstrapToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ connectionId: input.connectionId }),
        }),
      catch: (cause) =>
        new SshCredentialUnavailableError({
          connectionId: input.connectionId,
          detail:
            cause instanceof Error
              ? `Failed to reach desktop SSH credential service: ${cause.message}`
              : "Failed to reach desktop SSH credential service.",
        }),
    });

    if (!response.ok) {
      return yield* new SshCredentialUnavailableError({
        connectionId: input.connectionId,
        detail: `Desktop SSH credential service returned HTTP ${response.status}.`,
      });
    }

    const body: unknown = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) =>
        new SshCredentialUnavailableError({
          connectionId: input.connectionId,
          detail:
            cause instanceof Error
              ? `Failed to decode desktop SSH credential response: ${cause.message}`
              : "Failed to decode desktop SSH credential response.",
        }),
    });

    const secrets = yield* decodeAuthSecrets(body).pipe(
      Effect.mapError(
        (cause) =>
          new SshCredentialUnavailableError({
            connectionId: input.connectionId,
            detail:
              cause instanceof Error
                ? `Invalid desktop SSH credential response: ${cause.message}`
                : "Invalid desktop SSH credential response.",
          }),
      ),
    );

    return {
      ...(secrets.password === undefined ? {} : { password: secrets.password }),
      ...(secrets.passphrase === undefined ? {} : { passphrase: secrets.passphrase }),
    };
  });
