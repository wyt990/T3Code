import path from "node:path";

import { Effect } from "effect";

import { shellQuotePosix } from "../ssh/ssh2Adapter.ts";
import {
  WorkspaceExecutionError,
  type WorkspaceExecution,
} from "../workspace/Services/WorkspaceExecution.ts";

const remoteCodexBinaryCache = new Map<string, string>();
const remoteClaudeBinaryCache = new Map<string, string>();
const remoteCursorBinaryCache = new Map<string, string>();
const remoteOpenCodeBinaryCache = new Map<string, string>();

const remoteCodexProbeCommand = (commandName: string): string =>
  `command -v ${shellQuotePosix(commandName)} 2>/dev/null || which ${shellQuotePosix(commandName)} 2>/dev/null || type -p ${shellQuotePosix(commandName)} 2>/dev/null`;

export const remoteCodexCommandName = (localConfiguredPath: string): string => {
  const base = path.basename(localConfiguredPath);
  if (base.length === 0) {
    return "codex";
  }
  return base.replace(/\.exe$/i, "") || "codex";
};

export const resolveRemoteCodexBinaryPath = (
  execution: WorkspaceExecution,
  localConfiguredPath: string,
): Effect.Effect<string, WorkspaceExecutionError> => {
  const connectionId = execution.sshConnectionId;
  if (connectionId === undefined) {
    return Effect.fail(
      new WorkspaceExecutionError({
        kind: "ssh",
        operation: "resolveRemoteCodexBinaryPath",
        detail: "SSH connection id is required to probe a remote Codex binary.",
      }),
    );
  }

  const cached = remoteCodexBinaryCache.get(connectionId);
  if (cached !== undefined) {
    return Effect.succeed(cached);
  }

  const operation = "resolveRemoteCodexBinaryPath";
  const commandName = remoteCodexCommandName(localConfiguredPath);
  // Removed logging due to build errors - these are not Effect.gen functions

  return execution
    .exec({
      command: remoteCodexProbeCommand(commandName),
      cwd: execution.workspaceRoot,
    })
    .pipe(
      Effect.flatMap((result) => {
        // Removed logging due to build errors
        const candidate = result.stdout
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (result.exitCode !== 0 || candidate === undefined) {
          return Effect.fail(
            new WorkspaceExecutionError({
              kind: "ssh",
              operation: "resolveRemoteCodexBinaryPath",
              detail:
                result.stderr.trim().length > 0
                  ? `Remote Codex binary '${commandName}' was not found: ${result.stderr.trim()}`
                  : `Remote Codex binary '${commandName}' was not found on the SSH host.`,
            }),
          );
        }
        remoteCodexBinaryCache.set(connectionId, candidate);
        return Effect.succeed(candidate);
      }),
    );
};

export const clearRemoteCodexBinaryCacheForConnection = (connectionId: string): void => {
  remoteCodexBinaryCache.delete(connectionId);
};

export const remoteClaudeCommandName = (localConfiguredPath: string): string => {
  const base = path.basename(localConfiguredPath);
  if (base.length === 0) {
    return "claude";
  }
  const withoutExt = base.replace(/\.(exe|cmd)$/i, "");
  if (withoutExt.length === 0) {
    return "claude";
  }
  return withoutExt;
};

export const resolveRemoteClaudeBinaryPath = (
  execution: WorkspaceExecution,
  localConfiguredPath: string,
): Effect.Effect<string, WorkspaceExecutionError> => {
  const connectionId = execution.sshConnectionId;
  if (connectionId === undefined) {
    return Effect.fail(
      new WorkspaceExecutionError({
        kind: "ssh",
        operation: "resolveRemoteClaudeBinaryPath",
        detail: "SSH connection id is required to probe a remote Claude binary.",
      }),
    );
  }

  const cached = remoteClaudeBinaryCache.get(connectionId);
  if (cached !== undefined) {
    return Effect.succeed(cached);
  }

  const operation = "resolveRemoteClaudeBinaryPath";
  const commandName = remoteClaudeCommandName(localConfiguredPath);
  // Removed logging due to build errors

  return execution
    .exec({
      command: remoteCodexProbeCommand(commandName),
      cwd: execution.workspaceRoot,
    })
    .pipe(
      Effect.flatMap((result) => {
        // Removed logging due to build errors
        const candidate = result.stdout
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (result.exitCode !== 0 || candidate === undefined) {
          return Effect.fail(
            new WorkspaceExecutionError({
              kind: "ssh",
              operation: "resolveRemoteClaudeBinaryPath",
              detail:
                result.stderr.trim().length > 0
                  ? `Remote Claude binary '${commandName}' was not found: ${result.stderr.trim()}`
                  : `Remote Claude binary '${commandName}' was not found on the SSH host.`,
            }),
          );
        }
        remoteClaudeBinaryCache.set(connectionId, candidate);
        return Effect.succeed(candidate);
      }),
    );
};

export const clearRemoteClaudeBinaryCacheForConnection = (connectionId: string): void => {
  remoteClaudeBinaryCache.delete(connectionId);
};

export const remoteCursorCommandName = (localConfiguredPath: string): string => {
  const base = path.basename(localConfiguredPath);
  if (base.length === 0) {
    return "agent";
  }
  return base.replace(/\.exe$/i, "") || "agent";
};

export const resolveRemoteCursorBinaryPath = (
  execution: WorkspaceExecution,
  localConfiguredPath: string,
): Effect.Effect<string, WorkspaceExecutionError> => {
  const connectionId = execution.sshConnectionId;
  if (connectionId === undefined) {
    return Effect.fail(
      new WorkspaceExecutionError({
        kind: "ssh",
        operation: "resolveRemoteCursorBinaryPath",
        detail: "SSH connection id is required to probe a remote Cursor binary.",
      }),
    );
  }

  const cached = remoteCursorBinaryCache.get(connectionId);
  if (cached !== undefined) {
    return Effect.succeed(cached);
  }

  const operation = "resolveRemoteCursorBinaryPath";
  const commandName = remoteCursorCommandName(localConfiguredPath);
  // Removed logging due to build errors

  return execution
    .exec({
      command: remoteCodexProbeCommand(commandName),
      cwd: execution.workspaceRoot,
    })
    .pipe(
      Effect.flatMap((result) => {
        // Removed logging due to build errors
        const candidate = result.stdout
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (result.exitCode !== 0 || candidate === undefined) {
          return Effect.fail(
            new WorkspaceExecutionError({
              kind: "ssh",
              operation: "resolveRemoteCursorBinaryPath",
              detail:
                result.stderr.trim().length > 0
                  ? `Remote Cursor binary '${commandName}' was not found: ${result.stderr.trim()}`
                  : `Remote Cursor binary '${commandName}' was not found on the SSH host.`,
            }),
          );
        }
        remoteCursorBinaryCache.set(connectionId, candidate);
        return Effect.succeed(candidate);
      }),
    );
};

export const clearRemoteCursorBinaryCacheForConnection = (connectionId: string): void => {
  remoteCursorBinaryCache.delete(connectionId);
};

export const remoteOpenCodeCommandName = (localConfiguredPath: string): string => {
  const base = path.basename(localConfiguredPath);
  if (base.length === 0) {
    return "opencode";
  }
  return base.replace(/\.exe$/i, "") || "opencode";
};

export const resolveRemoteOpenCodeBinaryPath = (
  execution: WorkspaceExecution,
  localConfiguredPath: string,
): Effect.Effect<string, WorkspaceExecutionError> => {
  const connectionId = execution.sshConnectionId;
  if (connectionId === undefined) {
    return Effect.fail(
      new WorkspaceExecutionError({
        kind: "ssh",
        operation: "resolveRemoteOpenCodeBinaryPath",
        detail: "SSH connection id is required to probe a remote OpenCode binary.",
      }),
    );
  }

  const cached = remoteOpenCodeBinaryCache.get(connectionId);
  if (cached !== undefined) {
    return Effect.succeed(cached);
  }

  const operation = "resolveRemoteOpenCodeBinaryPath";
  const commandName = remoteOpenCodeCommandName(localConfiguredPath);
  // Removed logging due to build errors

  return execution
    .exec({
      command: remoteCodexProbeCommand(commandName),
      cwd: execution.workspaceRoot,
    })
    .pipe(
      Effect.flatMap((result) => {
        // Removed logging due to build errors
        const candidate = result.stdout
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        if (result.exitCode !== 0 || candidate === undefined) {
          return Effect.fail(
            new WorkspaceExecutionError({
              kind: "ssh",
              operation: "resolveRemoteOpenCodeBinaryPath",
              detail:
                result.stderr.trim().length > 0
                  ? `Remote OpenCode binary '${commandName}' was not found: ${result.stderr.trim()}`
                  : `Remote OpenCode binary '${commandName}' was not found on the SSH host.`,
            }),
          );
        }
        remoteOpenCodeBinaryCache.set(connectionId, candidate);
        return Effect.succeed(candidate);
      }),
    );
};

export const clearRemoteOpenCodeBinaryCacheForConnection = (connectionId: string): void => {
  remoteOpenCodeBinaryCache.delete(connectionId);
};
