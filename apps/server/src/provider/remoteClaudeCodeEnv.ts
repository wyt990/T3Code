import { Effect } from "effect";

import type { WorkspaceExecution } from "../workspace/Services/WorkspaceExecution.ts";

/** Parse a `.env` file body into key-value pairs (comments and blank lines skipped). */
export const parseClaudeEnvFileContent = (content: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      result[key] = value;
    }
  }
  return result;
};

const remoteClaudeEnvProbeCommand = `prefix="\${CLAUDE_CODE_INSTALL_PREFIX:-$HOME/.claude-code-local}"; if [ -f "$prefix/.env" ]; then cat "$prefix/.env"; fi`;

/** Load Claude Code `.env` from the SSH host (install prefix on the remote machine). */
export const loadRemoteClaudeCodeEnv = (
  execution: WorkspaceExecution,
): Effect.Effect<Record<string, string>> =>
  execution
    .exec({
      command: remoteClaudeEnvProbeCommand,
      cwd: execution.workspaceRoot,
    })
    .pipe(
      Effect.map((result) => {
        if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
          return {};
        }
        return parseClaudeEnvFileContent(result.stdout);
      }),
      Effect.catch(() => Effect.succeed({})),
    );

export const buildRemoteClaudeSpawnEnv = (input: {
  readonly remoteClaudeEnv: Record<string, string>;
}): Record<string, string> => ({
  ...input.remoteClaudeEnv,
  CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
});
