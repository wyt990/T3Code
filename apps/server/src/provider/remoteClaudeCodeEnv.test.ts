import { describe, expect, it } from "vitest";

import { parseClaudeEnvFileContent } from "./remoteClaudeCodeEnv.ts";

describe("remoteClaudeCodeEnv", () => {
  it("parses .env file content", () => {
    expect(
      parseClaudeEnvFileContent(`
# comment
ANTHROPIC_API_KEY=sk-test
CLAUDE_CODE_USE_OPENAI_COMPAT_API=true
`),
    ).toEqual({
      ANTHROPIC_API_KEY: "sk-test",
      CLAUDE_CODE_USE_OPENAI_COMPAT_API: "true",
    });
  });
});
