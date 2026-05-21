import { Schema } from "effect";

export class SshConnectionNotFoundError extends Schema.TaggedErrorClass<SshConnectionNotFoundError>()(
  "SshConnectionNotFoundError",
  {
    connectionId: Schema.String,
  },
) {
  override get message(): string {
    return `SSH connection not found: ${this.connectionId}`;
  }
}

export class SshCredentialUnavailableError extends Schema.TaggedErrorClass<SshCredentialUnavailableError>()(
  "SshCredentialUnavailableError",
  {
    connectionId: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `SSH credentials unavailable for ${this.connectionId}: ${this.detail}`;
  }
}

export class SshHostKeyUntrustedError extends Schema.TaggedErrorClass<SshHostKeyUntrustedError>()(
  "SshHostKeyUntrustedError",
  {
    host: Schema.String,
    port: Schema.Number,
    fingerprint: Schema.String,
    expectedFingerprint: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `Untrusted SSH host key for ${this.host}:${this.port} (${this.fingerprint})`;
  }
}

export class SshHostKeyUnknownError extends Schema.TaggedErrorClass<SshHostKeyUnknownError>()(
  "SshHostKeyUnknownError",
  {
    host: Schema.String,
    port: Schema.Number,
    fingerprint: Schema.String,
  },
) {
  override get message(): string {
    return `Unknown SSH host key for ${this.host}:${this.port} (${this.fingerprint})`;
  }
}

export class SshConnectionError extends Schema.TaggedErrorClass<SshConnectionError>()(
  "SshConnectionError",
  {
    connectionId: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `SSH connection failed for ${this.connectionId}: ${this.detail}`;
  }
}

export class SshCommandError extends Schema.TaggedErrorClass<SshCommandError>()("SshCommandError", {
  connectionId: Schema.String,
  command: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  stderr: Schema.optional(Schema.String),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `SSH command failed for ${this.connectionId}: ${this.detail}`;
  }
}

export class SshFileSystemError extends Schema.TaggedErrorClass<SshFileSystemError>()(
  "SshFileSystemError",
  {
    connectionId: Schema.String,
    path: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `SSH filesystem ${this.operation} failed for ${this.connectionId} at ${this.path}: ${this.detail}`;
  }
}

export const SshError = Schema.Union([
  SshConnectionNotFoundError,
  SshCredentialUnavailableError,
  SshHostKeyUntrustedError,
  SshHostKeyUnknownError,
  SshConnectionError,
  SshCommandError,
  SshFileSystemError,
]);
export type SshError = typeof SshError.Type;
