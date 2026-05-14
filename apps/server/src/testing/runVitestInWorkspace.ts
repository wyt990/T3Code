import { spawnSync } from "node:child_process";
import * as nodePath from "node:path";

import type { TestRunConfig, TestRunResult } from "@t3tools/contracts";

function spawnVitest(
  cwd: string,
  files: readonly string[],
  timeoutMs: number,
  vitestConfigPath: string | undefined,
): {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  cmd: string;
} {
  const rel = files.map((f) => f.replace(/\\/g, "/"));
  const args = ["vitest", "run", "--passWithNoTests"];
  const cfg = vitestConfigPath?.trim();
  if (cfg !== undefined && cfg.length > 0) {
    args.push("--config", cfg.replace(/\\/g, "/"));
  }
  args.push(...rel);

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

function spawnTurboTest(
  cwd: string,
  turboFilter: string | undefined,
  timeoutMs: number,
): {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  cmd: string;
} {
  const args = ["turbo", "run", "test"];
  const f = turboFilter?.trim();
  if (f !== undefined && f.length > 0) {
    args.push("--filter", f);
  }

  const tryBun = spawnSync("bun", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 48 * 1024 * 1024,
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
    maxBuffer: 48 * 1024 * 1024,
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
 * Runs `turbo run test` in `workspaceRoot` (same as root `bun run test` in this monorepo).
 */
export function runTurboTestInWorkspace(config: TestRunConfig): TestRunResult {
  const ws = config.workspaceRoot?.trim();
  const started = Date.now();
  if (ws === undefined || ws.length === 0) {
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
          message: "turbo 模式需要 workspaceRoot。",
        },
      ],
      completedAt: new Date().toISOString(),
    };
  }

  const abs = nodePath.resolve(ws);
  const timeoutMs = Math.max(10_000, Math.min(config.timeout, 900_000));
  const r = spawnTurboTest(abs, config.turboFilter, timeoutMs);
  const duration = Date.now() - started;
  const timedOut =
    r.signal === "SIGTERM" || (r.stderr + r.stdout).toLowerCase().includes("timeout");

  if (timedOut) {
    const stderrSnippet = r.stderr.slice(0, 4000);
    return {
      configId: config.id,
      status: "timed_out",
      duration,
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      testsSkipped: 0,
      failures: [
        {
          testId: "turbo",
          message: `turbo 超时或被杀（${timeoutMs}ms）。命令：${r.cmd}`,
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
    testsRun: ok ? 1 : 1,
    testsPassed: ok ? 1 : 0,
    testsFailed: ok ? 0 : 1,
    testsSkipped: 0,
    failures: ok
      ? []
      : [
          {
            testId: "turbo",
            message:
              (r.stderr || r.stdout || `turbo 退出码 ${String(r.status)}`).trim().slice(0, 8000) ||
              "turbo test 失败",
          },
        ],
    completedAt: new Date().toISOString(),
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

  const r = spawnVitest(abs, files, timeoutMs, config.vitestConfigPath);
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

/** vitest 文件子集或 turbo 全仓测试 */
export function executeWorkspaceTestRun(config: TestRunConfig): TestRunResult {
  if (config.turboRunTest === true) {
    return runTurboTestInWorkspace(config);
  }
  return runVitestInWorkspace(config);
}
