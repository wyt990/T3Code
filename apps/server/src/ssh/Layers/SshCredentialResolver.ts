import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { fetchDesktopSshAuthMaterial } from "../DesktopSshCredentialClient.ts";
import { SshConnectionNotFoundError, SshCredentialUnavailableError } from "../Errors.ts";
import {
  SshCredentialResolver,
  type SshAuthMaterial,
  type SshCredentialResolverShape,
} from "../Services/SshCredentialResolver.ts";
import { SshConnectionRegistry } from "../Services/SshConnectionRegistry.ts";

const desktopUnavailable = (connectionId: string, detail: string) =>
  Effect.fail(
    new SshCredentialUnavailableError({
      connectionId,
      detail,
    }),
  );

export const makeSshCredentialResolver = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const registry = yield* SshConnectionRegistry;

  const resolve: SshCredentialResolverShape["resolve"] = (connectionId) =>
    Effect.gen(function* () {
      const connection = yield* registry.getById(connectionId).pipe(
        Effect.mapError(
          (error) =>
            new SshCredentialUnavailableError({
              connectionId,
              detail:
                error instanceof SshConnectionNotFoundError
                  ? error.message
                  : "SSH connection metadata is unavailable.",
            }),
        ),
      );

      if (connection.authType === "agent") {
        return {} satisfies SshAuthMaterial;
      }

      if (config.mode !== "desktop") {
        return yield* desktopUnavailable(
          connectionId,
          "SSH password and passphrase storage require the desktop app.",
        );
      }

      if (config.sshCredentialPort === undefined || config.desktopBootstrapToken === undefined) {
        return yield* desktopUnavailable(
          connectionId,
          "Desktop SSH credential service is not available.",
        );
      }

      const secrets = yield* fetchDesktopSshAuthMaterial({
        port: config.sshCredentialPort,
        bootstrapToken: config.desktopBootstrapToken,
        connectionId,
      });

      if (connection.authType === "password" && secrets.password === undefined) {
        return yield* desktopUnavailable(
          connectionId,
          "No saved SSH password is available for this connection.",
        );
      }

      return secrets;
    });

  return { resolve } satisfies SshCredentialResolverShape;
});

export const SshCredentialResolverLive = Layer.effect(
  SshCredentialResolver,
  makeSshCredentialResolver,
);

export const makeSshCredentialResolverTestLayer = (
  materials: Readonly<Record<string, SshAuthMaterial>>,
) =>
  Layer.succeed(SshCredentialResolver, {
    resolve: (connectionId) => {
      const material = materials[connectionId];
      return material === undefined
        ? Effect.fail(
            new SshCredentialUnavailableError({
              connectionId,
              detail: "No test credentials configured for this connection id.",
            }),
          )
        : Effect.succeed(material);
    },
  });
