import * as Http from "node:http";

import { SshAuthSecrets } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { DesktopSecretStorage } from "./clientPersistence.ts";
import { readSshAuthSecrets } from "./sshPersistence.ts";

const CredentialRequestSchema = Schema.Struct({
  connectionId: Schema.String,
});

export interface SshCredentialServerOptions {
  readonly host?: string;
  readonly secretsPath: string;
  readonly bootstrapToken: string;
  readonly secretStorage: DesktopSecretStorage;
}

export interface SshCredentialServerHandle {
  readonly port: number;
  readonly close: () => Promise<void>;
}

export async function startSshCredentialServer(
  options: SshCredentialServerOptions,
): Promise<SshCredentialServerHandle> {
  const host = options.host ?? "127.0.0.1";

  const server = Http.createServer((request, response) => {
    void handleRequest(request, response, options).catch((error) => {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Internal credential server error",
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("SSH credential server failed to bind.");
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function handleRequest(
  request: Http.IncomingMessage,
  response: Http.ServerResponse,
  options: SshCredentialServerOptions,
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/v1/ssh/credential") {
    response.statusCode = 404;
    response.end();
    return;
  }

  const authorization = request.headers.authorization;
  const expected = `Bearer ${options.bootstrapToken}`;
  if (authorization !== expected) {
    response.statusCode = 401;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const body = await readRequestBody(request);
  const decoded = Schema.decodeUnknownSync(CredentialRequestSchema)(JSON.parse(body));
  const secrets = readSshAuthSecrets({
    secretsPath: options.secretsPath,
    connectionId: decoded.connectionId,
    secretStorage: options.secretStorage,
  });

  const payload = {
    ...(secrets.password === null ? {} : { password: secrets.password }),
    ...(secrets.passphrase === null ? {} : { passphrase: secrets.passphrase }),
  };
  Schema.decodeUnknownSync(SshAuthSecrets)(payload);

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function readRequestBody(request: Http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}
