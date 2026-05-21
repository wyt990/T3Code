import { describe, expect, it } from "vitest";

import { buildGitShellCommand, joinGitPath } from "./gitWorkspacePaths.ts";

describe("gitWorkspacePaths", () => {
  it("joins relative git paths with posix rules for SSH", () => {
    expect(joinGitPath("/home/user/repo", ".git", true)).toBe("/home/user/repo/.git");
    expect(joinGitPath("/home/user/repo", "/var/git", true)).toBe("/var/git");
  });

  it("quotes git shell commands for remote exec", () => {
    expect(buildGitShellCommand(["status", "--porcelain"])).toBe("git status --porcelain");
    expect(buildGitShellCommand(["-c", "safe.directory=*", "rev-parse"])).toBe(
      "git -c 'safe.directory=*' rev-parse",
    );
  });
});
