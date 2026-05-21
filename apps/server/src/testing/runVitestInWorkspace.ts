import { spawnSync } from "node:child_process";
import * as nodePath from "node:path";

import type { TestRunConfig, TestRunResult } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import type { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { shellQuotePosix } from "../ssh/ssh2Adapter.ts";
import { SSH_EXEC_TIMEOUT_MS } from "../ssh/sshConnectDefaults.ts";
import type {
  WorkspaceExecution,
  WorkspaceExecutionResolver,
} from "../workspace/Services/WorkspaceExecution.ts";
import { resolveWorkspaceExecutionForProject } from "../workspace/resolveWorkspaceExecutionByCwd.ts";

type SpawnOutcome = {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly cmd: string;
};

const clampTimeoutMs = (timeout: number): number => Math.max(10_000, Math.min(timeout, 900_000));

const resolveLocalWorkspaceCwd = (workspaceRoot: string): string => nodePath.resolve(workspaceRoot);

const buildVitestArgs = (
  files: readonly string[],
  vitestConfigPath: string | undefined,
): string[] => {
  const rel = files.map((f) => f.replace(/\\/g, "/"));
  const args = ["vitest", "run", "--passWithNoTests"];
  const cfg = vitestConfigPath?.trim();
  if (cfg !== undefined && cfg.length > 0) {
    args.push("--config", cfg.replace(/\\/g, "/"));
  }
  args.push(...rel);
  return args;
};

const buildVitestShellCommand = (
  runner: "bun" | "npx",
  files: readonly string[],
  vitestConfigPath: string | undefined,
): string => [runner, ...buildVitestArgs(files, vitestConfigPath)].map(shellQuotePosix).join(" ");

const buildTurboShellCommand = (turboFilter: string | undefined): string => {
  const args = ["turbo", "run", "test"];
  const f = turboFilter?.trim();
  if (f !== undefined && f.length > 0) {
    args.push("--filter", f);
  }
  return ["bun", ...args].map(shellQuotePosix).join(" ");
};

const buildTurboNpxShellCommand = (turboFilter: string | undefined): string => {
  const args = ["turbo", "run", "test"];
  const f = turboFilter?.trim();
  if (f !== undefined && f.length > 0) {
    args.push("--filter", f);
  }
  return ["npx", ...args].map(shellQuotePosix).join(" ");
};

const isRunnerMissing = (outcome: SpawnOutcome): boolean =>
  /ENOENT|command not found|not found:/i.test(`${outcome.stderr}\n${outcome.stdout}`);

function spawnVitest(
  cwd: string,
  files: readonly string[],
  timeoutMs: number,
  vitestConfigPath: string | undefined,
): SpawnOutcome {
  const args = buildVitestArgs(files, vitestConfigPath);

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
): SpawnOutcome {
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

const execOutcomeFromWorkspace = (
  result: { readonly stdout: string; readonly stderr: string; readonly exitCode: number },
  cmd: string,
): SpawnOutcome => ({
  status: result.exitCode,
  signal: null,
  stdout: result.stdout,
  stderr: result.stderr,
  cmd,
});

const runRemoteExecWithRunnerFallback = (
  execution: WorkspaceExecution,
  input: {
    readonly cwd: string;
    readonly primaryCommand: string;
    readonly fallbackCommand: string;
  },
) =>
  Effect.gen(function* () {
    let outcome = execOutcomeFromWorkspace(
      yield* execution.exec({ command: input.primaryCommand, cwd: input.cwd }),
      input.primaryCommand,
    );
    if (outcome.status !== 0 && isRunnerMissing(outcome)) {
      outcome = execOutcomeFromWorkspace(
        yield* execution.exec({ command: input.fallbackCommand, cwd: input.cwd }),
        input.fallbackCommand,
      );
    }
    return outcome;
  });

const isTimedOut = (outcome: SpawnOutcome, timeoutMs: number): boolean =>
  outcome.signal === "SIGTERM" ||
  (outcome.stderr + outcome.stdout).toLowerCase().includes("timeout") ||
  outcome.stderr.includes("远程命令执行超时");

const configErrorResult = (
  config: TestRunConfig,
  message: string,
  started: number,
): TestRunResult => ({
  configId: config.id,
  status: "error",
  duration: Date.now() - started,
  testsRun: 0,
  testsPassed: 0,
  testsFailed: 0,
  testsSkipped: 0,
  failures: [{ testId: "config", message }],
  completedAt: new Date().toISOString(),
});

const executionErrorResult = (
  config: TestRunConfig,
  started: number,
  cause: unknown,
): TestRunResult => ({
  configId: config.id,
  status: "error",
  duration: Date.now() - started,
  testsRun: 0,
  testsPassed: 0,
  testsFailed: 0,
  testsSkipped: 0,
  failures: [
    {
      testId: "exec",
      message: cause instanceof Error ? cause.message : String(cause),
    },
  ],
  completedAt: new Date().toISOString(),
});

const turboResultFromOutcome = (
  config: TestRunConfig,
  outcome: SpawnOutcome,
  duration: number,
  timeoutMs: number,
): TestRunResult => {
  if (isTimedOut(outcome, timeoutMs)) {
    const stderrSnippet = outcome.stderr.slice(0, 4000);
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
          message: `turbo 超时或被杀（${timeoutMs}ms，远程 exec 上限 ${SSH_EXEC_TIMEOUT_MS}ms）。命令：${outcome.cmd}`,
          ...(stderrSnippet.length > 0 ? { stack: stderrSnippet } : {}),
        },
      ],
      completedAt: new Date().toISOString(),
    };
  }

  const ok = outcome.status === 0;
  return {
    configId: config.id,
    status: ok ? "passed" : "failed",
    duration,
    testsRun: 1,
    testsPassed: ok ? 1 : 0,
    testsFailed: ok ? 0 : 1,
    testsSkipped: 0,
    failures: ok
      ? []
      : [
          {
            testId: "turbo",
            message:
              (outcome.stderr || outcome.stdout || `turbo 退出码 ${String(outcome.status)}`)
                .trim()
                .slice(0, 8000) || "turbo test 失败",
          },
        ],
    completedAt: new Date().toISOString(),
  };
};

const vitestResultFromOutcome = (
  config: TestRunConfig,
  files: readonly string[],
  outcome: SpawnOutcome,
  duration: number,
  timeoutMs: number,
): TestRunResult => {
  if (isTimedOut(outcome, timeoutMs)) {
    const stderrSnippet = outcome.stderr.slice(0, 4000);
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
          message: `vitest 超时或被杀（${timeoutMs}ms，远程 exec 上限 ${SSH_EXEC_TIMEOUT_MS}ms）。命令：${outcome.cmd}`,
          ...(stderrSnippet.length > 0 ? { stack: stderrSnippet } : {}),
        },
      ],
      completedAt: new Date().toISOString(),
    };
  }

  const ok = outcome.status === 0;
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
              (outcome.stderr || outcome.stdout || `vitest 退出码 ${String(outcome.status)}`)
                .trim()
                .slice(0, 4000) || "vitest 运行失败",
          },
        ],
    completedAt: new Date().toISOString(),
  };
};

export const runTurboTestInWorkspaceRemote = (
  config: TestRunConfig,
  execution: WorkspaceExecution,
): Effect.Effect<TestRunResult> => {
  const started = Date.now();
  const ws = config.workspaceRoot?.trim();
  if (ws === undefined || ws.length === 0) {
    return Effect.succeed(configErrorResult(config, "turbo 模式需要 workspaceRoot。", started));
  }

  const cwd = execution.workspaceRoot;
  const timeoutMs = clampTimeoutMs(config.timeout);
  const primary = buildTurboShellCommand(config.turboFilter);
  const fallback = buildTurboNpxShellCommand(config.turboFilter);

  return runRemoteExecWithRunnerFallback(execution, {
    cwd,
    primaryCommand: primary,
    fallbackCommand: fallback,
  }).pipe(
    Effect.map((outcome) =>
      turboResultFromOutcome(config, outcome, Date.now() - started, timeoutMs),
    ),
    Effect.catch((cause) => Effect.succeed(executionErrorResult(config, started, cause))),
  );
};

export const runVitestInWorkspaceRemote = (
  config: TestRunConfig,
  execution: WorkspaceExecution,
): Effect.Effect<TestRunResult> => {
  const started = Date.now();
  const ws = config.workspaceRoot?.trim();
  if (ws === undefined || ws.length === 0 || config.testFiles.length === 0) {
    return Effect.succeed(
      configErrorResult(config, "缺少 workspaceRoot 或 testFiles，无法执行 vitest。", started),
    );
  }

  const files = config.testFiles.slice(0, 40);
  const cwd = execution.workspaceRoot;
  const timeoutMs = clampTimeoutMs(config.timeout);
  const primary = buildVitestShellCommand("bun", files, config.vitestConfigPath);
  const fallback = buildVitestShellCommand("npx", files, config.vitestConfigPath);

  return runRemoteExecWithRunnerFallback(execution, {
    cwd,
    primaryCommand: primary,
    fallbackCommand: fallback,
  }).pipe(
    Effect.map((outcome) =>
      vitestResultFromOutcome(config, files, outcome, Date.now() - started, timeoutMs),
    ),
    Effect.catch((cause) => Effect.succeed(executionErrorResult(config, started, cause))),
  );
};

/**
 * Runs `turbo run test` in `workspaceRoot` (same as root `bun run test` in this monorepo).
 */
export function runTurboTestInWorkspace(config: TestRunConfig): TestRunResult {
  const ws = config.workspaceRoot?.trim();
  const started = Date.now();
  if (ws === undefined || ws.length === 0) {
    return configErrorResult(config, "turbo 模式需要 workspaceRoot。", started);
  }

  const abs = resolveLocalWorkspaceCwd(ws);
  const timeoutMs = clampTimeoutMs(config.timeout);
  const r = spawnTurboTest(abs, config.turboFilter, timeoutMs);
  return turboResultFromOutcome(config, r, Date.now() - started, timeoutMs);
}

/**
 * Runs `vitest` in `workspaceRoot` against the given relative test paths.
 * Prefers `bun vitest run`, falls back to `npx vitest run`.
 */
export function runVitestInWorkspace(config: TestRunConfig): TestRunResult {
  const ws = config.workspaceRoot?.trim();
  const started = Date.now();
  if (ws === undefined || ws.length === 0 || config.testFiles.length === 0) {
    return configErrorResult(config, "缺少 workspaceRoot 或 testFiles，无法执行 vitest。", started);
  }

  const abs = resolveLocalWorkspaceCwd(ws);
  const files = config.testFiles.slice(0, 40);
  const timeoutMs = clampTimeoutMs(config.timeout);
  const r = spawnVitest(abs, files, timeoutMs, config.vitestConfigPath);
  return vitestResultFromOutcome(config, files, r, Date.now() - started, timeoutMs);
}

/** vitest 文件子集或 turbo 全仓测试（本机） */
export function executeWorkspaceTestRun(config: TestRunConfig): TestRunResult {
  if (config.turboRunTest === true) {
    return runTurboTestInWorkspace(config);
  }
  return runVitestInWorkspace(config);
}

export const executeWorkspaceTestRunEffect = (
  config: TestRunConfig,
  deps: {
    readonly projectionSnapshotQuery: ProjectionSnapshotQuery["Service"];
    readonly workspaceExecutionResolver: WorkspaceExecutionResolver["Service"];
  },
): Effect.Effect<TestRunResult> => {
  const started = Date.now();
  const ws = config.workspaceRoot?.trim();
  const turbo = config.turboRunTest === true;
  const hasFiles = config.testFiles.length > 0;

  if (ws === undefined || ws.length === 0 || (!turbo && !hasFiles)) {
    return Effect.succeed(
      configErrorResult(
        config,
        turbo
          ? "turbo 模式需要 workspaceRoot。"
          : "缺少 workspaceRoot 或 testFiles，无法执行测试。",
        started,
      ),
    );
  }

  return Effect.gen(function* () {
    const projectOption = yield* deps.projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(ws);
    const executionOption = yield* resolveWorkspaceExecutionForProject(
      projectOption,
      deps.workspaceExecutionResolver,
    );

    if (Option.isNone(executionOption)) {
      return executeWorkspaceTestRun(config);
    }

    const execution = executionOption.value;
    if (turbo) {
      return yield* runTurboTestInWorkspaceRemote(config, execution);
    }
    return yield* runVitestInWorkspaceRemote(config, execution);
  }).pipe(Effect.catch((cause) => Effect.succeed(executionErrorResult(config, started, cause))));
};
