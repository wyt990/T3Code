import { describe, expect, it } from "vitest";

import { joinPosix, resolveRelativePathWithinPosixRoot } from "./posixPaths.ts";

describe("posixPaths", () => {
  it("joins absolute posix paths", () => {
    expect(joinPosix("/home/user", "repo", "src")).toBe("/home/user/repo/src");
  });

  it("resolves relative paths within a posix workspace root", () => {
    expect(
      resolveRelativePathWithinPosixRoot({
        workspaceRoot: "/home/user/repo",
        relativePath: "plans/effect-rpc.md",
      }),
    ).toEqual({
      absolutePath: "/home/user/repo/plans/effect-rpc.md",
      relativePath: "plans/effect-rpc.md",
    });
  });

  it("rejects traversal outside the workspace root", () => {
    expect(
      resolveRelativePathWithinPosixRoot({
        workspaceRoot: "/home/user/repo",
        relativePath: "../escape.md",
      }),
    ).toEqual({ outsideRoot: true });
  });
});
