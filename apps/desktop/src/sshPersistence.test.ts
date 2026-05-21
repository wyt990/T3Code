import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DesktopSecretStorage } from "./clientPersistence.ts";
import {
  readSshAuthSecrets,
  readSshSecret,
  removeSshSecrets,
  writeSshSecret,
} from "./sshPersistence.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeTempSecretsPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "t3-ssh-persistence-test-"));
  tempDirectories.push(directory);
  return path.join(directory, "ssh-secrets.json");
}

function makeSecretStorage(available: boolean): DesktopSecretStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (value) => {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("enc:")) {
        throw new Error("invalid secret");
      }
      return decoded.slice("enc:".length);
    },
  };
}

describe("sshPersistence", () => {
  it("persists password and passphrase across reloads", () => {
    const secretsPath = makeTempSecretsPath();
    const secretStorage = makeSecretStorage(true);
    const connectionId = "conn-1";

    expect(
      writeSshSecret({
        secretsPath,
        connectionId,
        kind: "password",
        value: "hunter2",
        secretStorage,
      }),
    ).toBe(true);
    expect(
      writeSshSecret({
        secretsPath,
        connectionId,
        kind: "passphrase",
        value: "key-pass",
        secretStorage,
      }),
    ).toBe(true);

    expect(
      readSshSecret({
        secretsPath,
        connectionId,
        kind: "password",
        secretStorage,
      }),
    ).toBe("hunter2");
    expect(
      readSshAuthSecrets({
        secretsPath,
        connectionId,
        secretStorage,
      }),
    ).toEqual({
      password: "hunter2",
      passphrase: "key-pass",
    });

    removeSshSecrets({ secretsPath, connectionId });
    expect(
      readSshAuthSecrets({
        secretsPath,
        connectionId,
        secretStorage,
      }),
    ).toEqual({
      password: null,
      passphrase: null,
    });
  });

  it("returns null when encryption is unavailable", () => {
    const secretsPath = makeTempSecretsPath();
    const secretStorage = makeSecretStorage(false);

    expect(
      writeSshSecret({
        secretsPath,
        connectionId: "conn-2",
        kind: "password",
        value: "secret",
        secretStorage,
      }),
    ).toBe(false);
    expect(
      readSshSecret({
        secretsPath,
        connectionId: "conn-2",
        kind: "password",
        secretStorage,
      }),
    ).toBeNull();
  });
});
