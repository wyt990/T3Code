import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

import type { DependencyAuditFinding, DependencyAuditSeverity } from "@t3tools/contracts";

const MAX_FINDINGS = 48;

const severityRank: Record<DependencyAuditSeverity, number> = {
  critical: 5,
  high: 4,
  moderate: 3,
  low: 2,
  info: 1,
};

const normalizeSeverity = (raw: unknown): DependencyAuditSeverity => {
  if (typeof raw !== "string") {
    return "info";
  }
  const s = raw.toLowerCase();
  if (s === "critical" || s === "high" || s === "moderate" || s === "low" || s === "info") {
    return s;
  }
  return "info";
};

const nonEmptyTitle = (raw: string, fallback: string): string => {
  const t = raw.trim();
  return t.length > 0 ? t : fallback;
};

interface NpmVulnEntry {
  readonly name?: string;
  readonly severity?: string;
  readonly range?: string;
  readonly via?: ReadonlyArray<unknown>;
}

function extractTitleFromVia(via: ReadonlyArray<unknown> | undefined): {
  title: string;
  url?: string;
} {
  if (!via || via.length === 0) {
    return { title: "安全公告" };
  }
  for (const item of via) {
    if (typeof item === "string") {
      return { title: nonEmptyTitle(item, "依赖链中的已知问题") };
    }
    if (typeof item === "object" && item !== null) {
      const o = item as Record<string, unknown>;
      const title =
        typeof o.title === "string"
          ? o.title
          : typeof o.name === "string"
            ? o.name
            : typeof o.dependency === "string"
              ? o.dependency
              : "";
      const url = typeof o.url === "string" ? o.url : undefined;
      return {
        title: nonEmptyTitle(title, "安全公告"),
        ...(url !== undefined && url.length > 0 ? { url } : {}),
      };
    }
  }
  return { title: "安全公告" };
}

/**
 * Parses `npm audit --json` / compatible `bun audit --json` stdout into flat findings.
 * Exported for unit tests.
 */
export function parseDependencyAuditJson(text: string): DependencyAuditFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return [
      {
        packageName: "(audit)",
        severity: "info",
        title: "无法解析审计 JSON",
        detail: "命令输出不是合法 JSON。",
      },
    ];
  }

  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const root = parsed as Record<string, unknown>;
  if ("error" in root && root.error !== undefined) {
    const err = root.error as Record<string, unknown>;
    const summary =
      typeof err.summary === "string"
        ? err.summary
        : typeof err.message === "string"
          ? err.message
          : "npm audit 返回错误";
    return [
      {
        packageName: "(audit)",
        severity: "info",
        title: "审计未执行",
        detail: summary.slice(0, 2000),
      },
    ];
  }

  const vulnBlock = root.vulnerabilities;
  if (typeof vulnBlock !== "object" || vulnBlock === null) {
    return [];
  }

  const findings: DependencyAuditFinding[] = [];
  for (const [key, rawEntry] of Object.entries(vulnBlock)) {
    if (rawEntry === null || typeof rawEntry !== "object") {
      continue;
    }
    const entry = rawEntry as NpmVulnEntry;
    const pkg = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : key;
    const sev = normalizeSeverity(entry.severity);
    const { title, url } = extractTitleFromVia(entry.via);
    const range =
      typeof entry.range === "string" && entry.range.length > 0 ? entry.range : undefined;
    findings.push({
      packageName: pkg,
      severity: sev,
      title: nonEmptyTitle(title, "安全公告"),
      ...(range !== undefined ? { range } : {}),
      ...(url !== undefined && url.length > 0 ? { url } : {}),
    });
  }

  findings.sort(
    (a, b) =>
      severityRank[b.severity] - severityRank[a.severity] ||
      a.packageName.localeCompare(b.packageName),
  );

  return findings.slice(0, MAX_FINDINGS);
}

function spawnAuditJson(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): { ok: boolean; stdout: string; stderr: string; cmd: string } {
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const stdout = typeof r.stdout === "string" ? r.stdout : "";
  const stderr = typeof r.stderr === "string" ? r.stderr : "";
  return {
    ok: !r.error,
    stdout,
    stderr,
    cmd: `${command} ${args.join(" ")}`.trim(),
  };
}

/**
 * Runs `npm audit --json` in `workspaceRoot`, then falls back to `bun audit --json`.
 */
export function runDependencyAuditInWorkspace(workspaceRoot: string): DependencyAuditFinding[] {
  const root = workspaceRoot.trim();
  if (root.length === 0) {
    return [
      {
        packageName: "(workspace)",
        severity: "info",
        title: "未提供工作区路径",
        detail: "需要有效的工作区根目录才能运行审计。",
      },
    ];
  }

  const resolved = nodePath.resolve(root);
  try {
    if (!nodeFs.existsSync(nodePath.join(resolved, "package.json"))) {
      return [
        {
          packageName: "(workspace)",
          severity: "info",
          title: "未找到 package.json",
          detail: "当前目录下没有 package.json，已跳过 npm/bun 审计。",
        },
      ];
    }
  } catch {
    return [
      {
        packageName: "(workspace)",
        severity: "info",
        title: "无法读取工作区",
        detail: "检查 package.json 时发生 IO 错误。",
      },
    ];
  }

  const timeoutMs = 120_000;
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const npm = spawnAuditJson(npmCmd, ["audit", "--json"], resolved, timeoutMs);
  if (npm.ok && npm.stdout.trim().length > 0) {
    return parseDependencyAuditJson(npm.stdout);
  }

  const bun = spawnAuditJson("bun", ["audit", "--json"], resolved, timeoutMs);
  if (bun.ok && bun.stdout.trim().length > 0) {
    return parseDependencyAuditJson(bun.stdout);
  }

  const hint = [npm.stderr, bun.stderr]
    .filter((s) => s.trim().length > 0)
    .join(" | ")
    .slice(0, 1500);
  return [
    {
      packageName: "(audit)",
      severity: "info",
      title: "未能完成依赖审计",
      detail: `未得到可用的 audit JSON。请确认已安装 npm 或 bun，且在工作区已执行过依赖安装。${hint ? ` 参考：${hint}` : ""}`,
    },
  ];
}
