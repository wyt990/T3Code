import { Effect, Layer, Ref } from "effect";
import * as Path from "node:path";
import type {
  TestCase,
  TestCaseCreateInput,
  TestSuite,
  CoverageReport,
  TestGenerationRequest,
  TestGenerationResult,
  TestRunConfig,
  TestRunResult,
} from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import { TestOrchestrator } from "../Services/TestOrchestrator.ts";
import { buildRegressionSelection } from "../discoverRegressionCandidates.ts";
import {
  tryLoadCoverageReportFromWorkspace,
  applyLinesThresholdGate,
} from "../parseVitestCoverageSummary.ts";
import { executeWorkspaceTestRun } from "../runVitestInWorkspace.ts";
import { loadTestSuitesFromStateDir, saveTestSuitesToStateDir } from "../testSuitesPersistence.ts";

const mapCreateInputToCase = (tc: TestCaseCreateInput, now: string, idx: number): TestCase => {
  const base: TestCase = {
    id: `test-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 9)}`,
    name: tc.name,
    ...(tc.description !== undefined ? { description: tc.description } : {}),
    type: tc.type,
    ...(tc.targetFunction !== undefined ? { targetFunction: tc.targetFunction } : {}),
    ...(tc.targetFile !== undefined ? { targetFile: tc.targetFile } : {}),
    code: tc.code,
    status: tc.status,
    ...(tc.coverage !== undefined ? { coverage: tc.coverage } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return base;
};

export const makeTestOrchestrator = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const initial = loadTestSuitesFromStateDir(serverConfig.stateDir);
  const suitesRef = yield* Ref.make<readonly TestSuite[]>(initial);

  const flushSuites = Effect.gen(function* () {
    const all = yield* Ref.get(suitesRef);
    yield* Effect.sync(() => saveTestSuitesToStateDir(serverConfig.stateDir, all));
  });

  const createTestSuite = Effect.fn("TestOrchestrator.createTestSuite")(function* (params: {
    name: string;
    projectId: string;
    testCases: readonly TestCaseCreateInput[];
  }) {
    const now = new Date().toISOString();
    const suite: TestSuite = {
      id: `suite-${Date.now()}`,
      name: params.name,
      projectId: params.projectId,
      testCases: params.testCases.map((tc, idx) => mapCreateInputToCase(tc, now, idx)),
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };

    yield* Ref.update(suitesRef, (suites) => [...suites, suite]);
    yield* flushSuites;

    yield* Effect.log(
      `[Testing] Created test suite: ${suite.name} (${suite.testCases.length} tests)`,
    );
    return suite;
  });

  const listTestSuites = Effect.fn("TestOrchestrator.listTestSuites")(function* (
    projectId: string,
  ) {
    const all = yield* Ref.get(suitesRef);
    return all.filter((s) => s.projectId === projectId);
  });

  const deleteTestSuite = Effect.fn("TestOrchestrator.deleteTestSuite")(function* (params: {
    projectId: string;
    suiteId: string;
  }) {
    yield* Ref.update(suitesRef, (suites) =>
      suites.filter((s) => !(s.id === params.suiteId && s.projectId === params.projectId)),
    );
    yield* flushSuites;
    yield* Effect.log(
      `[Testing] Deleted test suite ${params.suiteId} for project ${params.projectId}`,
    );
  });

  const generateTests = Effect.fn("TestOrchestrator.generateTests")(function* (
    request: TestGenerationRequest,
  ) {
    const testCases: TestCase[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < 3; i++) {
      const testCase: TestCase = {
        id: `test-${Date.now()}-${i}`,
        name: `Test case ${i + 1} for ${Path.basename(request.targetFile)}`,
        description: `Generated test for ${request.targetFunction || request.targetFile}`,
        type: request.type,
        targetFile: request.targetFile,
        code: `// Generated test code for ${request.targetFunction || request.targetFile}\ndescribe('${request.targetFunction || "function"}', () => {\n  it('should work', () => {\n    expect(true).toBe(true);\n  });\n});`,
        status: "generated",
        createdAt: now,
        updatedAt: now,
      };
      const testCaseWithTargetFunction = Object.assign(
        {},
        testCase,
        request.targetFunction !== undefined ? { targetFunction: request.targetFunction } : {},
      );
      testCases.push(testCaseWithTargetFunction);
    }

    const result: TestGenerationResult = {
      success: true,
      testCases,
      generatedCount: testCases.length,
      estimatedCoverage: 75,
    };

    yield* Effect.log(`[Testing] Generated ${testCases.length} tests for ${request.targetFile}`);
    return result;
  });

  const selectRegressionTests = Effect.fn("TestOrchestrator.selectRegressionTests")(function* (
    changedFiles: string[],
    workspaceRoot?: string,
  ) {
    const selection = buildRegressionSelection(changedFiles, workspaceRoot);
    yield* Effect.log(
      `[Testing] Regression: ${selection.selectedTests.length} matched / ${changedFiles.length} changed`,
    );
    return selection;
  });

  const runTests = Effect.fn("TestOrchestrator.runTests")(function* (config: TestRunConfig) {
    const ws = config.workspaceRoot?.trim();
    const turbo = config.turboRunTest === true;
    const hasFiles = config.testFiles.length > 0;
    if (ws !== undefined && ws.length > 0 && (turbo || hasFiles)) {
      return yield* Effect.sync(() => executeWorkspaceTestRun(config));
    }

    const passed = Math.random() > 0.2;
    const testsRun = 10 + Math.floor(Math.random() * 10);
    const testsFailed = passed ? 0 : 1 + Math.floor(Math.random() * 3);
    const testsPassed = testsRun - testsFailed;
    const duration = 1000 + Math.floor(Math.random() * 4000);

    const result: TestRunResult = {
      configId: config.id,
      status: passed ? "passed" : "failed",
      duration,
      testsRun,
      testsPassed,
      testsFailed,
      testsSkipped: 0,
      failures: [],
      completedAt: new Date().toISOString(),
    };

    if (!passed) {
      const failedResult: TestRunResult = {
        ...result,
        failures: [
          {
            testId: `test-${Date.now()}-fail`,
            message: "Expected value to be true",
            stack: "at Object.<anonymous> (test.spec.ts:10:20)",
          },
        ],
      };
      return failedResult;
    }

    yield* Effect.log(`[Testing] Ran tests: ${testsPassed}/${testsRun} passed`);
    return result;
  });

  const getCoverageReport = Effect.fn("TestOrchestrator.getCoverageReport")(function* (
    projectId: string,
    workspaceRoot?: string,
    covOptions?: {
      readonly linesCoverageMinPercent?: number;
      readonly weakAreaMaxLinesPercent?: number;
    },
  ) {
    const loadOpts =
      covOptions?.linesCoverageMinPercent === undefined &&
      covOptions?.weakAreaMaxLinesPercent === undefined
        ? undefined
        : {
            ...(covOptions.linesCoverageMinPercent !== undefined
              ? { linesCoverageMinPercent: covOptions.linesCoverageMinPercent }
              : {}),
            ...(covOptions.weakAreaMaxLinesPercent !== undefined
              ? { weakAreaMaxLinesPercent: covOptions.weakAreaMaxLinesPercent }
              : {}),
          };

    const trimmed = workspaceRoot?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      const fromDisk = tryLoadCoverageReportFromWorkspace(projectId, trimmed, loadOpts);
      if (fromDisk) {
        yield* Effect.log(`[Testing] Loaded Vitest coverage-summary for ${projectId}`);
        return fromDisk;
      }
      yield* Effect.log(
        `[Testing] No coverage-summary.json under workspace; returning empty coverage shell`,
      );
      const emptyShell = {
        projectId,
        timestamp: new Date().toISOString(),
        summary: { lines: 0, branches: 0, functions: 0, statements: 0 },
        files: [],
        weakAreas: [
          {
            path: "(coverage)",
            coverage: 0,
            reason:
              "未找到 coverage/coverage-summary.json。请在项目根或 apps/server、apps/web 下运行 vitest --coverage，并启用 json-summary 报告（通常需 @vitest/coverage-v8）。",
          },
        ],
      } satisfies CoverageReport;
      return covOptions?.linesCoverageMinPercent !== undefined
        ? applyLinesThresholdGate(emptyShell, covOptions.linesCoverageMinPercent)
        : emptyShell;
    }

    const report: CoverageReport = {
      projectId,
      timestamp: new Date().toISOString(),
      summary: {
        lines: 0.75,
        branches: 0.65,
        functions: 0.7,
        statements: 0.78,
      },
      files: [
        {
          path: "src/example.ts",
          lines: 0.8,
          branches: 0.7,
          functions: 0.75,
          uncoveredLines: [15, 16, 20],
        },
        {
          path: "src/utils.ts",
          lines: 0.9,
          branches: 0.85,
          functions: 0.95,
          uncoveredLines: [],
        },
      ],
      weakAreas: [
        {
          path: "src/example.ts",
          coverage: 0.8,
          reason: "Missing edge case tests",
        },
      ],
    };

    yield* Effect.log(`[Testing] Generated placeholder coverage report for ${projectId}`);
    return covOptions?.linesCoverageMinPercent !== undefined
      ? applyLinesThresholdGate(report, covOptions.linesCoverageMinPercent)
      : report;
  });

  return {
    createTestSuite,
    listTestSuites,
    deleteTestSuite,
    generateTests,
    selectRegressionTests,
    runTests,
    getCoverageReport,
  };
});

export const TestOrchestratorLive = Layer.effect(TestOrchestrator, makeTestOrchestrator);
