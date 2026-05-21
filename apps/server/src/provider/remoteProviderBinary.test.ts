import { describe, expect, it } from "vitest";

import {
  remoteClaudeCommandName,
  remoteCodexCommandName,
  remoteCursorCommandName,
  remoteOpenCodeCommandName,
} from "./remoteProviderBinary.ts";

describe("remoteProviderBinary", () => {
  it("derives remote codex command name from local configured path", () => {
    expect(remoteCodexCommandName("codex")).toBe("codex");
    expect(remoteCodexCommandName("C:\\Users\\me\\AppData\\codex.exe")).toBe("codex");
    expect(remoteCodexCommandName("/usr/local/bin/codex")).toBe("codex");
  });

  it("derives remote claude command name from local configured path", () => {
    expect(remoteClaudeCommandName("claude")).toBe("claude");
    expect(remoteClaudeCommandName("claudecode.cmd")).toBe("claudecode");
    expect(remoteClaudeCommandName("C:\\Users\\me\\claudecode.exe")).toBe("claudecode");
  });

  it("derives remote cursor command name from local configured path", () => {
    expect(remoteCursorCommandName("agent")).toBe("agent");
    expect(remoteCursorCommandName("C:\\Users\\me\\agent.exe")).toBe("agent");
    expect(remoteCursorCommandName("/usr/local/bin/cursor-agent")).toBe("cursor-agent");
  });

  it("derives remote opencode command name from local configured path", () => {
    expect(remoteOpenCodeCommandName("opencode")).toBe("opencode");
    expect(remoteOpenCodeCommandName("C:\\Users\\me\\opencode.exe")).toBe("opencode");
    expect(remoteOpenCodeCommandName("/usr/local/bin/opencode")).toBe("opencode");
  });
});
