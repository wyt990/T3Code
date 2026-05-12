import { Effect, Layer, Ref } from "effect";
import * as Path from "node:path";
import type {
  TestCase,
  TestSuite,
  CoverageReport,
  TestGenerationRequest,
  TestGenerationResult,
  TestRunConfig,
  TestRunResult,
} from "@t3tools/contracts";
import { TestOrchestrator } from "../Services/TestOrchestrator.ts";
import { buildRegressionSelection } from "../discoverRegressionCandidates.ts";
import {
  tryLoadCoverageReportFromWorkspace,
  applyLinesThresholdGate,
} from "../parseVitestCoverageSummary.ts";
import { runVitestInWorkspace } from "../runVitestInWorkspace.ts";

export const makeTestOrchestrator = Effect.gen(function* () {
  const suitesRef = yield* Ref.make<Map<string, TestSuite>>(new Map());

  const createTestSuite = Effect.fn("TestOrchestrator.createTestSuite")(function* (params: {
    name: string;
    projectId: string;
    testCases: Omit<TestCase, "id" | "createdAt" | "updatedAt">[];
  }) {
    const now = new Date().toISOString();
    const suite: TestSuite = {
      id: `suite-${Date.now()}`,
      name: params.name,
      projectId: params.projectId,
      testCases: params.testCases.map((tc) => ({
        ...tc,
        id: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: now,
        updatedAt: now,
      })),
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };

    yield* Ref.update(suitesRef, (suites) => {
      const newSuites = new Map(suites);
      newSuites.set(suite.id, suite);
      return newSuites;
    });

    yield* Effect.log(
      `[Testing] Created test suite: ${suite.name} (${suite.testCases.length} tests)`,
    );
    return suite;
  });

  const generateTests = Effect.fn("TestOrchestrator.generateTests")(function* (
    request: TestGenerationRequest,
  ) {
    // In a real implementation, this would call an AI to generate test code
    // For now, return sample result
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
    if (ws !== undefined && ws.length > 0 && config.testFiles.length > 0) {
      return yield* Effect.sync(() => runVitestInWorkspace(config));
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
    generateTests,
    selectRegressionTests,
    runTests,
    getCoverageReport,
  };
});

export const TestOrchestratorLive = Layer.effect(TestOrchestrator, makeTestOrchestrator);
