import { Context, Effect } from "effect";
import type {
  TestCase,
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
    testCases: Omit<TestCase, "id" | "createdAt" | "updatedAt">[];
  }) => Effect.Effect<TestSuite, never, never>;
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
