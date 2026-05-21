import { describe, expect, it } from "vitest";

import {
  appendSshBrowsePathSegment,
  canNavigateSshUp,
  getSshBrowseDirectoryPath,
  getSshBrowseLeafPathSegment,
  getSshBrowseParentPath,
  hasTrailingSshPathSeparator,
  resolveSshProjectWorkspaceRoot,
} from "./sshProjectPaths";

describe("sshProjectPaths", () => {
  it("navigates posix browse paths", () => {
    expect(getSshBrowseDirectoryPath("/home/user")).toBe("/home/");
    expect(getSshBrowseDirectoryPath("/home/user/")).toBe("/home/user/");
    expect(getSshBrowseLeafPathSegment("/home/user/repo")).toBe("repo");
    expect(appendSshBrowsePathSegment("/home/", "user")).toBe("/home/user/");
    expect(getSshBrowseParentPath("/home/user/repo")).toBe("/home/user/");
    expect(canNavigateSshUp("/")).toBe(false);
    expect(canNavigateSshUp("/home")).toBe(true);
    expect(hasTrailingSshPathSeparator("/home/user/")).toBe(true);
    expect(resolveSshProjectWorkspaceRoot("/home/user/repo/")).toBe("/home/user/repo");
  });
});
