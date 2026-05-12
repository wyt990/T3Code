import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { discoverTestFilePaths, matchRegressionTestPaths } from "./discoverRegressionCandidates.ts";

describe("discoverRegressionCandidates", () => {
  let tmp: string | null = null;

  afterEach(() => {
    if (tmp !== null) {
      nodeFs.rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it("discovers test files and matches by source stem", () => {
    tmp = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "t3-reg-"));
    const srcDir = nodePath.join(tmp, "apps", "demo", "src");
    nodeFs.mkdirSync(srcDir, { recursive: true });
    nodeFs.writeFileSync(nodePath.join(srcDir, "widget.ts"), "export const x = 1");
    nodeFs.writeFileSync(nodePath.join(srcDir, "widget.test.ts"), "import { x } from './widget'");

    const tests = discoverTestFilePaths(tmp, 100);
    expect(tests.some((t) => t.endsWith("widget.test.ts"))).toBe(true);

    const matched = matchRegressionTestPaths(["apps/demo/src/widget.ts"], tests);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0]).toContain("widget.test.ts");
  });
});
