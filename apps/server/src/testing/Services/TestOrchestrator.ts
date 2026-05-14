import { Context, Effect } from "effect";
import type {
  TestCaseCreateInput,
  TestSuite,
  CoverageReport,
  TestGenerationRequest,
  TestGenerationResult,
  RegressionTestSelection,
  TestRunConfig,
  TestRunResult,
} from "@t3tools/contracts";

export interface TestOrchestrator {
  readonly createTestSuite: (params: {
    name: string;
    projectId: string;
    testCases: readonly TestCaseCreateInput[];
  }) => Effect.Effect<TestSuite, never, never>;
  readonly listTestSuites: (
    projectId: string,
  ) => Effect.Effect<ReadonlyArray<TestSuite>, never, never>;
  readonly deleteTestSuite: (params: {
    projectId: string;
    suiteId: string;
  }) => Effect.Effect<void, never, never>;
  readonly generateTests: (
    request: TestGenerationRequest,
  ) => Effect.Effect<TestGenerationResult, never, never>;
  readonly selectRegressionTests: (
    changedFiles: string[],
    workspaceRoot?: string | undefined,
  ) => Effect.Effect<RegressionTestSelection, never, never>;
  readonly runTests: (config: TestRunConfig) => Effect.Effect<TestRunResult, never, never>;
  readonly getCoverageReport: (
    projectId: string,
    workspaceRoot?: string | undefined,
    options?: {
      readonly linesCoverageMinPercent?: number;
      readonly weakAreaMaxLinesPercent?: number;
    },
  ) => Effect.Effect<CoverageReport, never, never>;
}

export const TestOrchestrator = Context.Service<TestOrchestrator>(
  "@t3tools/server/testing/TestOrchestrator",
);
