import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

import type { TestSuite } from "@t3tools/contracts";

const FILE_NAME = "testing-suites-v1.json";

type DiskFile = {
  readonly version: 1;
  readonly suites: readonly TestSuite[];
};

export function testSuitesFilePath(stateDir: string): string {
  return nodePath.join(stateDir, FILE_NAME);
}

export function loadTestSuitesFromStateDir(stateDir: string): TestSuite[] {
  const filePath = testSuitesFilePath(stateDir);
  try {
    if (!nodeFs.existsSync(filePath)) {
      return [];
    }
    const raw = nodeFs.readFileSync(filePath, "utf8");
    if (raw.length === 0) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }
    const v = (parsed as { version?: unknown }).version;
    const suites = (parsed as { suites?: unknown }).suites;
    if (v !== 1 || !Array.isArray(suites)) {
      return [];
    }
    return suites as TestSuite[];
  } catch {
    return [];
  }
}

export function saveTestSuitesToStateDir(stateDir: string, suites: readonly TestSuite[]): void {
  const filePath = testSuitesFilePath(stateDir);
  const body: DiskFile = { version: 1, suites: [...suites] };
  try {
    nodeFs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
    nodeFs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  } catch {
    // best-effort persistence
  }
}
