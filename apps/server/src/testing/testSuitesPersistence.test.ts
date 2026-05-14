import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadTestSuitesFromStateDir,
  saveTestSuitesToStateDir,
  testSuitesFilePath,
} from "./testSuitesPersistence.ts";

describe("testSuitesPersistence", () => {
  it("round-trips suites json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-test-suites-"));
    const now = new Date().toISOString();
    const suites = [
      {
        id: "suite-1",
        name: "A",
        projectId: "p1",
        testCases: [],
        status: "idle" as const,
        createdAt: now,
        updatedAt: now,
      },
    ];
    saveTestSuitesToStateDir(dir, suites);
    expect(fs.existsSync(testSuitesFilePath(dir))).toBe(true);
    const loaded = loadTestSuitesFromStateDir(dir);
    expect(loaded).toEqual(suites);
  });
});
