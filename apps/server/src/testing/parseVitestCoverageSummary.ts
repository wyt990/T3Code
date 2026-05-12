import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

import type { CoverageReport, FileCoverage, WeakArea } from "@t3tools/contracts";

export interface LoadCoverageSummaryOptions {
  /** 1–99：行覆盖率低于该百分比的文件进入 `weakAreas`（默认 50） */
  readonly weakAreaMaxLinesPercent?: number;
  /** 0–100：若设置，则根据整包 `summary.lines` 写入 `linesThresholdGate` */
  readonly linesCoverageMinPercent?: number;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function applyLinesThresholdGate(
  report: CoverageReport,
  linesCoverageMinPercent: number,
): CoverageReport {
  const minPct = clampInt(linesCoverageMinPercent, 0, 100);
  const actualPct = Math.round(report.summary.lines * 100);
  const passed = report.summary.lines >= minPct / 100;
  return {
    ...report,
    linesThresholdGate: {
      linesMinPercent: minPct,
      actualLinesPercent: actualPct,
      passed,
    },
  };
}

interface SummaryMetric {
  readonly pct?: number;
  readonly total?: number;
  readonly covered?: number;
}

interface SummaryFileEntry {
  readonly lines?: SummaryMetric;
  readonly branches?: SummaryMetric;
  readonly functions?: SummaryMetric;
  readonly statements?: SummaryMetric;
}

type SummaryJson = Record<string, SummaryFileEntry | undefined>;

const pctToRatio = (metric: SummaryMetric | undefined): number => {
  if (metric === undefined) {
    return 0;
  }
  const raw = metric.pct;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(1, Math.max(0, raw / 100));
  }
  const { total, covered } = metric;
  if (typeof total === "number" && total > 0 && typeof covered === "number") {
    return Math.min(1, Math.max(0, covered / total));
  }
  return 0;
};

const normalizeDisplayPath = (workspaceRoot: string, fileKey: string): string => {
  const absRoot = nodePath.resolve(workspaceRoot);
  const absKey = nodePath.isAbsolute(fileKey) ? fileKey : nodePath.resolve(workspaceRoot, fileKey);
  const rel = nodePath.relative(absRoot, absKey);
  if (rel.startsWith("..") || nodePath.isAbsolute(rel)) {
    return fileKey.replace(/\\/g, "/");
  }
  return rel.replace(/\\/g, "/");
};

/**
 * Reads Vitest `@vitest/coverage-v8` / Istanbul `json-summary` output
 * (`coverage/coverage-summary.json`) when present under `workspaceRoot`.
 */
export function tryLoadCoverageReportFromWorkspace(
  projectId: string,
  workspaceRoot: string,
  options?: LoadCoverageSummaryOptions,
): CoverageReport | null {
  const root = workspaceRoot.trim();
  if (root.length === 0) {
    return null;
  }

  const candidates = [
    nodePath.join(root, "coverage", "coverage-summary.json"),
    nodePath.join(root, "apps", "server", "coverage", "coverage-summary.json"),
    nodePath.join(root, "apps", "web", "coverage", "coverage-summary.json"),
  ];

  let chosen: string | null = null;
  for (const p of candidates) {
    try {
      if (nodeFs.existsSync(p)) {
        chosen = p;
        break;
      }
    } catch {
      // ignore
    }
  }
  if (chosen === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(nodeFs.readFileSync(chosen, "utf8")) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const summaryJson = parsed as SummaryJson;
  const total = summaryJson.total;
  if (total === undefined) {
    return null;
  }

  const summary = {
    lines: pctToRatio(total.lines),
    branches: pctToRatio(total.branches),
    functions: pctToRatio(total.functions),
    statements: pctToRatio(total.statements ?? total.lines),
  };

  const files: FileCoverage[] = [];
  for (const [key, entry] of Object.entries(summaryJson)) {
    if (key === "total" || entry === undefined) {
      continue;
    }
    files.push({
      path: normalizeDisplayPath(root, key),
      lines: pctToRatio(entry.lines),
      branches: pctToRatio(entry.branches ?? entry.lines),
      functions: pctToRatio(entry.functions ?? entry.lines),
      uncoveredLines: [],
    });
  }

  files.sort((a, b) => a.lines - b.lines);

  const weakPct = clampInt(options?.weakAreaMaxLinesPercent ?? 50, 1, 99);
  const weakThreshold = weakPct / 100;
  const weakAreas: WeakArea[] = files
    .filter((f) => f.lines < weakThreshold)
    .slice(0, 12)
    .map((f) => ({
      path: f.path,
      coverage: f.lines,
      reason: `行覆盖率低于 ${weakPct}%`,
    }));

  let report: CoverageReport = {
    projectId,
    timestamp: new Date().toISOString(),
    summary,
    files,
    weakAreas,
  };

  if (options?.linesCoverageMinPercent !== undefined) {
    report = applyLinesThresholdGate(report, options.linesCoverageMinPercent);
  }

  return report;
}
