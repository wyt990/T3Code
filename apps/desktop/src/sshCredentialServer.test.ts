import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DesktopSecretStorage } from "./clientPersistence.ts";
import { writeSshSecret } from "./sshPersistence.ts";
import { startSshCredentialServer } from "./sshCredentialServer.ts";

const tempDirectories: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeSecretStorage(): DesktopSecretStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8");
      return decoded.slice("enc:".length);
    },
  };
}

describe("sshCredentialServer", () => {
  it("returns saved secrets to authorized backend requests", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ssh-credential-server-"));
    tempDirectories.push(directory);
    const secretsPath = path.join(directory, "ssh-secrets.json");
    const secretStorage = makeSecretStorage();
    const bootstrapToken = "desktop-bootstrap-token";

    writeSshSecret({
      secretsPath,
      connectionId: "conn-1",
      kind: "password",
      value: "hunter2",
      secretStorage,
    });

    const server = await startSshCredentialServer({
      secretsPath,
      bootstrapToken,
      secretStorage,
    });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/v1/ssh/credential`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bootstrapToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ password: "hunter2" });
  });

  it("rejects requests without the bootstrap token", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ssh-credential-server-"));
    tempDirectories.push(directory);
    const secretsPath = path.join(directory, "ssh-secrets.json");
    const secretStorage = makeSecretStorage();

    const server = await startSshCredentialServer({
      secretsPath,
      bootstrapToken: "expected-token",
      secretStorage,
    });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/v1/ssh/credential`, {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(401);
  });
});
