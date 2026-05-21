import { readFile } from "node:fs/promises";

import type { SshConnectionConfig } from "@t3tools/contracts";
import type { ConnectConfig } from "ssh2";
import { Effect } from "effect";

import { SshConnectionError } from "./Errors.ts";
import { defaultSshConnectConfigFields } from "./sshConnectDefaults.ts";
import type { SshAuthSecrets } from "@t3tools/contracts";

export const readSshPrivateKey = (connectionId: string, path: string) =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new SshConnectionError({
        connectionId,
        detail: `Failed to read private key at ${path}`,
        cause,
      }),
  });

export const buildSshConnectConfig = (input: {
  readonly connection: SshConnectionConfig;
  readonly auth: SshAuthSecrets;
  readonly hostVerifier?: ConnectConfig["hostVerifier"];
}): Effect.Effect<ConnectConfig, SshConnectionError> =>
  Effect.gen(function* () {
    const config: ConnectConfig = {
      host: input.connection.host,
      port: input.connection.port,
      username: input.connection.username,
      ...defaultSshConnectConfigFields(),
      ...(input.hostVerifier === undefined ? {} : { hostVerifier: input.hostVerifier }),
    };

    if (input.connection.authType === "password") {
      if (input.auth.password === undefined) {
        return yield* new SshConnectionError({
          connectionId: input.connection.id,
          detail: "Password auth selected but no password credential is available.",
        });
      }
      config.password = input.auth.password;
    }

    if (input.connection.authType === "privateKey") {
      if (input.connection.privateKeyPath === undefined) {
        return yield* new SshConnectionError({
          connectionId: input.connection.id,
          detail: "privateKey auth selected but privateKeyPath is missing.",
        });
      }
      config.privateKey = yield* readSshPrivateKey(
        input.connection.id,
        input.connection.privateKeyPath,
      );
      if (input.auth.passphrase !== undefined) {
        config.passphrase = input.auth.passphrase;
      }
    }

    if (input.connection.authType === "agent") {
      const agentSocket = process.env.SSH_AUTH_SOCK;
      if (agentSocket === undefined || agentSocket.length === 0) {
        return yield* new SshConnectionError({
          connectionId: input.connection.id,
          detail: "SSH agent auth selected but SSH_AUTH_SOCK is not set.",
        });
      }
      config.agent = agentSocket;
    }

    return config;
  });
