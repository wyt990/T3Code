import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderKind } from "./orchestration.ts";

export const SshAuthType = Schema.Literals(["password", "privateKey", "agent"]);
export type SshAuthType = typeof SshAuthType.Type;

/** Secret kinds stored in Desktop safeStorage (never in ssh-connections.json). */
export const SshSecretKind = Schema.Literals(["password", "passphrase"]);
export type SshSecretKind = typeof SshSecretKind.Type;

/** Material returned to the server when resolving SSH auth (desktop-only secrets). */
export const SshAuthSecrets = Schema.Struct({
  password: Schema.optional(Schema.String),
  passphrase: Schema.optional(Schema.String),
});
export type SshAuthSecrets = typeof SshAuthSecrets.Type;

export const SshConnectionStatus = Schema.Literals([
  "disconnected",
  "connecting",
  "connected",
  "error",
]);
export type SshConnectionStatus = typeof SshConnectionStatus.Type;

/** Non-secret SSH connection metadata (secrets stored via Desktop IPC). */
export const SshConnectionConfig = Schema.Struct({
  id: Schema.String,
  host: TrimmedNonEmptyString,
  port: Schema.Number,
  username: TrimmedNonEmptyString,
  authType: SshAuthType,
  privateKeyPath: Schema.optional(Schema.String),
  label: TrimmedNonEmptyString,
  status: SshConnectionStatus,
  lastConnectedAt: Schema.optional(IsoDateTime),
  lastError: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SshConnectionConfig = typeof SshConnectionConfig.Type;

export const SshConnectionSummary = Schema.Struct({
  id: Schema.String,
  host: TrimmedNonEmptyString,
  port: Schema.Number,
  username: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  authType: SshAuthType,
  privateKeyPath: Schema.optional(Schema.String),
  status: SshConnectionStatus,
  lastConnectedAt: Schema.optional(IsoDateTime),
  lastError: Schema.optional(Schema.String),
});
export type SshConnectionSummary = typeof SshConnectionSummary.Type;

export const SshListDirectoryInput = Schema.Struct({
  connectionId: Schema.String,
  path: TrimmedNonEmptyString,
});
export type SshListDirectoryInput = typeof SshListDirectoryInput.Type;

export const SshDirectoryBrowseEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  fullPath: TrimmedNonEmptyString,
  type: Schema.Literals(["file", "directory", "symlink", "other"]),
});
export type SshDirectoryBrowseEntry = typeof SshDirectoryBrowseEntry.Type;

export const SshListDirectoryResult = Schema.Struct({
  parentPath: TrimmedNonEmptyString,
  entries: Schema.Array(SshDirectoryBrowseEntry),
});
export type SshListDirectoryResult = typeof SshListDirectoryResult.Type;

/** Writable connection fields (secrets are stored separately). */
export const SshUpsertConnectionInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  host: TrimmedNonEmptyString,
  port: Schema.optional(Schema.Number),
  username: TrimmedNonEmptyString,
  authType: SshAuthType,
  privateKeyPath: Schema.optional(Schema.String),
  label: TrimmedNonEmptyString,
});
export type SshUpsertConnectionInput = typeof SshUpsertConnectionInput.Type;

export const SshDeleteConnectionInput = Schema.Struct({
  id: Schema.String,
});
export type SshDeleteConnectionInput = typeof SshDeleteConnectionInput.Type;

export const SshTestConnectionInput = Schema.Struct({
  connectionId: Schema.String,
});
export type SshTestConnectionInput = typeof SshTestConnectionInput.Type;

export const SshHostKeyPrompt = Schema.Struct({
  host: TrimmedNonEmptyString,
  port: Schema.Number,
  fingerprint: TrimmedNonEmptyString,
});
export type SshHostKeyPrompt = typeof SshHostKeyPrompt.Type;

export const SshTestConnectionResult = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(TrimmedNonEmptyString),
  hostKey: Schema.optional(SshHostKeyPrompt),
});
export type SshTestConnectionResult = typeof SshTestConnectionResult.Type;

export const SshConfirmHostKeyInput = Schema.Struct({
  host: TrimmedNonEmptyString,
  port: Schema.Number,
  fingerprint: TrimmedNonEmptyString,
});
export type SshConfirmHostKeyInput = typeof SshConfirmHostKeyInput.Type;

export const SshProviderProbeEntry = Schema.Struct({
  provider: ProviderKind,
  available: Schema.Boolean,
  binaryPath: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  probedAt: IsoDateTime,
});
export type SshProviderProbeEntry = typeof SshProviderProbeEntry.Type;

export const SshListProviderProbesInput = Schema.Struct({
  connectionId: Schema.String,
});
export type SshListProviderProbesInput = typeof SshListProviderProbesInput.Type;

export const SshListProviderProbesResult = Schema.Struct({
  connectionId: Schema.String,
  probes: Schema.Array(SshProviderProbeEntry),
});
export type SshListProviderProbesResult = typeof SshListProviderProbesResult.Type;

export class SshListDirectoryError extends Schema.TaggedErrorClass<SshListDirectoryError>()(
  "SshListDirectoryError",
  {
    connectionId: Schema.String,
    path: Schema.String,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `SSH directory listing failed for ${this.connectionId} at ${this.path}: ${this.detail}`;
  }
}
