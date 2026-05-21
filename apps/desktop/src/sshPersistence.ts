import * as FS from "node:fs";
import * as Path from "node:path";

import type { SshSecretKind } from "@t3tools/contracts";
import { Predicate } from "effect";

import type { DesktopSecretStorage } from "./clientPersistence.ts";

interface SshSecretStorageRecord {
  readonly connectionId: string;
  readonly encryptedPassword?: string;
  readonly encryptedPassphrase?: string;
}

interface SshSecretsDocument {
  readonly secrets: readonly SshSecretStorageRecord[];
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!FS.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(FS.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  const directory = Path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, filePath);
}

function isSshSecretStorageRecord(value: unknown): value is SshSecretStorageRecord {
  return (
    Predicate.isObject(value) &&
    typeof value.connectionId === "string" &&
    (value.encryptedPassword === undefined || typeof value.encryptedPassword === "string") &&
    (value.encryptedPassphrase === undefined || typeof value.encryptedPassphrase === "string")
  );
}

function readSecretsDocument(filePath: string): SshSecretsDocument {
  const parsed = readJsonFile<SshSecretsDocument>(filePath);
  if (!Predicate.isObject(parsed)) {
    return { secrets: [] };
  }

  return {
    secrets: Array.isArray(parsed.secrets) ? parsed.secrets.filter(isSshSecretStorageRecord) : [],
  };
}

const secretFieldForKind = (kind: SshSecretKind): "encryptedPassword" | "encryptedPassphrase" =>
  kind === "password" ? "encryptedPassword" : "encryptedPassphrase";

export function readSshSecret(input: {
  readonly secretsPath: string;
  readonly connectionId: string;
  readonly kind: SshSecretKind;
  readonly secretStorage: DesktopSecretStorage;
}): string | null {
  const document = readSecretsDocument(input.secretsPath);
  const field = secretFieldForKind(input.kind);
  const encoded = document.secrets.find((record) => record.connectionId === input.connectionId)?.[
    field
  ];
  if (encoded === undefined) {
    return null;
  }

  if (!input.secretStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    return input.secretStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
}

export function writeSshSecret(input: {
  readonly secretsPath: string;
  readonly connectionId: string;
  readonly kind: SshSecretKind;
  readonly value: string;
  readonly secretStorage: DesktopSecretStorage;
}): boolean {
  if (!input.secretStorage.isEncryptionAvailable()) {
    return false;
  }

  const document = readSecretsDocument(input.secretsPath);
  const field = secretFieldForKind(input.kind);
  const encrypted = input.secretStorage.encryptString(input.value).toString("base64");

  let found = false;
  const nextSecrets = document.secrets.map((record) => {
    if (record.connectionId !== input.connectionId) {
      return record;
    }
    found = true;
    return {
      ...record,
      [field]: encrypted,
    };
  });

  writeJsonFile(input.secretsPath, {
    secrets: found
      ? nextSecrets
      : [
          ...nextSecrets,
          {
            connectionId: input.connectionId,
            [field]: encrypted,
          },
        ],
  });
  return true;
}

export function removeSshSecrets(input: {
  readonly secretsPath: string;
  readonly connectionId: string;
}): void {
  const document = readSecretsDocument(input.secretsPath);
  if (!document.secrets.some((record) => record.connectionId === input.connectionId)) {
    return;
  }

  writeJsonFile(input.secretsPath, {
    secrets: document.secrets.filter((record) => record.connectionId !== input.connectionId),
  } satisfies SshSecretsDocument);
}

export function readSshAuthSecrets(input: {
  readonly secretsPath: string;
  readonly connectionId: string;
  readonly secretStorage: DesktopSecretStorage;
}): { readonly password: string | null; readonly passphrase: string | null } {
  return {
    password: readSshSecret({
      secretsPath: input.secretsPath,
      connectionId: input.connectionId,
      kind: "password",
      secretStorage: input.secretStorage,
    }),
    passphrase: readSshSecret({
      secretsPath: input.secretsPath,
      connectionId: input.connectionId,
      kind: "passphrase",
      secretStorage: input.secretStorage,
    }),
  };
}
