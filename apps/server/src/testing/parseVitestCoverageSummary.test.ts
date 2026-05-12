import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { tryLoadCoverageReportFromWorkspace } from "./parseVitestCoverageSummary.ts";

describe("tryLoadCoverageReportFromWorkspace", () => {
  let tmp: string | null = null;

  afterEach(() => {
    if (tmp !== null) {
      nodeFs.rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it("parses Vitest json-summary total and file entries", () => {
    tmp = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "t3-cov-"));
    const covDir = nodePath.join(tmp, "coverage");
    nodeFs.mkdirSync(covDir, { recursive: true });
    const summary = {
      total: {
        lines: { pct: 50 },
        branches: { pct: 40 },
        functions: { pct: 60 },
        statements: { pct: 55 },
      },
      "src/a.ts": {
        lines: { pct: 30 },
        branches: { pct: 25 },
        functions: { pct: 35 },
      },
    };
    nodeFs.writeFileSync(nodePath.join(covDir, "coverage-summary.json"), JSON.stringify(summary));

    const report = tryLoadCoverageReportFromWorkspace("proj-1", tmp);
    expect(report).not.toBeNull();
    expect(report!.summary.lines).toBe(0.5);
    expect(report!.summary.branches).toBe(0.4);
    expect(report!.files).toHaveLength(1);
    expect(report!.files[0]!.path).toContain("src/a.ts");
    expect(report!.files[0]!.lines).toBe(0.3);
    expect(report!.weakAreas.length).toBeGreaterThan(0);
  });

  it("respects weakAreaMaxLinesPercent for weak file selection", () => {
    tmp = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "t3-cov-"));
    const covDir = nodePath.join(tmp, "coverage");
    nodeFs.mkdirSync(covDir, { recursive: true });
    const summary = {
      total: {
        lines: { pct: 80 },
        branches: { pct: 70 },
        functions: { pct: 75 },
        statements: { pct: 78 },
      },
      "src/a.ts": {
        lines: { pct: 30 },
        branches: { pct: 25 },
        functions: { pct: 35 },
      },
    };
    nodeFs.writeFileSync(nodePath.join(covDir, "coverage-summary.json"), JSON.stringify(summary));

    const strict = tryLoadCoverageReportFromWorkspace("proj-1", tmp, {
      weakAreaMaxLinesPercent: 40,
    });
    expect(strict!.weakAreas.some((w) => w.path.includes("src/a.ts"))).toBe(true);

    const loose = tryLoadCoverageReportFromWorkspace("proj-1", tmp, {
      weakAreaMaxLinesPercent: 25,
    });
    expect(loose!.weakAreas.some((w) => w.path.includes("src/a.ts"))).toBe(false);
  });

  it("adds linesThresholdGate when linesCoverageMinPercent is set", () => {
    tmp = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "t3-cov-"));
    const covDir = nodePath.join(tmp, "coverage");
    nodeFs.mkdirSync(covDir, { recursive: true });
    const summary = {
      total: {
        lines: { pct: 50 },
        branches: { pct: 40 },
        functions: { pct: 60 },
        statements: { pct: 55 },
      },
      "src/a.ts": {
        lines: { pct: 30 },
        branches: { pct: 25 },
        functions: { pct: 35 },
      },
    };
    nodeFs.writeFileSync(nodePath.join(covDir, "coverage-summary.json"), JSON.stringify(summary));

    const noGate = tryLoadCoverageReportFromWorkspace("proj-1", tmp);
    expect(noGate!.linesThresholdGate).toBeUndefined();

    const gated = tryLoadCoverageReportFromWorkspace("proj-1", tmp, {
      linesCoverageMinPercent: 60,
    });
    expect(gated!.linesThresholdGate).toBeDefined();
    expect(gated!.linesThresholdGate!.passed).toBe(false);
    expect(gated!.linesThresholdGate!.linesMinPercent).toBe(60);
    expect(gated!.linesThresholdGate!.actualLinesPercent).toBe(50);

    const pass = tryLoadCoverageReportFromWorkspace("proj-1", tmp, { linesCoverageMinPercent: 40 });
    expect(pass!.linesThresholdGate!.passed).toBe(true);
  });

  it("returns null when summary file is missing", () => {
    tmp = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "t3-cov-"));
    expect(tryLoadCoverageReportFromWorkspace("p", tmp)).toBeNull();
  });
});
