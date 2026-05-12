import { spawnSync } from "node:child_process";
import * as nodePath from "node:path";

import type { TestRunConfig, TestRunResult } from "@t3tools/contracts";

function spawnVitest(
  cwd: string,
  files: readonly string[],
  timeoutMs: number,
): {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  cmd: string;
} {
  const rel = files.map((f) => f.replace(/\\/g, "/"));
  const args = ["vitest", "run", "--passWithNoTests", ...rel];

  const tryBun = spawnSync("bun", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 24 * 1024 * 1024,
  });
  if (!tryBun.error) {
    return {
      status: tryBun.status,
      signal: tryBun.signal,
      stdout: tryBun.stdout ?? "",
      stderr: tryBun.stderr ?? "",
      cmd: `bun ${args.join(" ")}`,
    };
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const tryNpx = spawnSync(npx, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 24 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  return {
    status: tryNpx.status,
    signal: tryNpx.signal,
    stdout: tryNpx.stdout ?? "",
    stderr: tryNpx.stderr ?? "",
    cmd: `${npx} ${args.join(" ")}`,
  };
}

/**
 * Runs `vitest` in `workspaceRoot` against the given relative test paths.
 * Prefers `bun vitest run`, falls back to `npx vitest run`.
 */
export function runVitestInWorkspace(config: TestRunConfig): TestRunResult {
  const ws = config.workspaceRoot?.trim();
  const started = Date.now();
  if (ws === undefined || ws.length === 0 || config.testFiles.length === 0) {
    return {
      configId: config.id,
      status: "error",
      duration: 0,
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      failures: [
        {
          testId: "config",
          message: "缺少 workspaceRoot 或 testFiles，无法执行 vitest。",
        },
      ],
      completedAt: new Date().toISOString(),
    };
  }

  const abs = nodePath.resolve(ws);
  const files = config.testFiles.slice(0, 40);
  const timeoutMs = Math.max(10_000, Math.min(config.timeout, 900_000));

  const r = spawnVitest(abs, files, timeoutMs);
  const duration = Date.now() - started;
  const timedOut =
    r.signal === "SIGTERM" || (r.stderr + r.stdout).toLowerCase().includes("timeout");

  if (timedOut) {
    const stderrSnippet = r.stderr.slice(0, 4000);
    return {
      configId: config.id,
      status: "timed_out",
      duration,
      testsRun: files.length,
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      failures: [
        {
          testId: "vitest",
          message: `vitest 超时或被杀（${timeoutMs}ms）。命令：${r.cmd}`,
          ...(stderrSnippet.length > 0 ? { stack: stderrSnippet } : {}),
        },
      ],
      completedAt: new Date().toISOString(),
    };
  }

  const ok = r.status === 0;
  return {
    configId: config.id,
    status: ok ? "passed" : "failed",
    duration,
    testsRun: files.length,
    testsPassed: ok ? files.length : 0,
    testsFailed: ok ? 0 : 1,
    testsSkipped: 0,
    failures: ok
      ? []
      : [
          {
            testId: "vitest",
            message:
              (r.stderr || r.stdout || `vitest 退出码 ${String(r.status)}`).trim().slice(0, 4000) ||
              "vitest 运行失败",
          },
        ],
    completedAt: new Date().toISOString(),
  };
}
