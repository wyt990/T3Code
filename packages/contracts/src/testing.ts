import { Effect, Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

// =============================================================================
// Testing Schema
// =============================================================================

export const TestCoverage = Schema.Struct({
  lines: Schema.Number,
  branches: Schema.Number,
  functions: Schema.Number,
});
export type TestCoverage = typeof TestCoverage.Type;

export const TestCase = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  type: Schema.Literals(["unit", "integration", "e2e"]),
  targetFunction: Schema.optionalKey(TrimmedNonEmptyString),
  targetFile: Schema.optionalKey(TrimmedNonEmptyString),
  code: TrimmedNonEmptyString,
  status: Schema.Literals(["draft", "generated", "verified", "failed"]),
  coverage: Schema.optionalKey(TestCoverage),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
});
export type TestCase = typeof TestCase.Type;

export const TestSuite = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  projectId: TrimmedNonEmptyString,
  testCases: Schema.Array(TestCase),
  status: Schema.Literals(["idle", "running", "completed", "failed"]),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
});
export type TestSuite = typeof TestSuite.Type;

export const FileCoverage = Schema.Struct({
  path: TrimmedNonEmptyString,
  lines: Schema.Number,
  branches: Schema.Number,
  functions: Schema.Number,
  uncoveredLines: Schema.Array(Schema.Number),
});
export type FileCoverage = typeof FileCoverage.Type;

export const WeakArea = Schema.Struct({
  path: TrimmedNonEmptyString,
  coverage: Schema.Number,
  reason: TrimmedNonEmptyString,
});
export type WeakArea = typeof WeakArea.Type;

export const CoverageSummary = Schema.Struct({
  lines: Schema.Number,
  branches: Schema.Number,
  functions: Schema.Number,
  statements: Schema.Number,
});
export type CoverageSummary = typeof CoverageSummary.Type;

/** 当请求携带 `linesCoverageMinPercent` 时，服务端写入整包行覆盖率是否达标。 */
export const CoverageLinesThresholdGate = Schema.Struct({
  linesMinPercent: Schema.Int,
  actualLinesPercent: Schema.Int,
  passed: Schema.Boolean,
});
export type CoverageLinesThresholdGate = typeof CoverageLinesThresholdGate.Type;

export const CoverageReport = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  timestamp: TrimmedNonEmptyString,
  summary: CoverageSummary,
  files: Schema.Array(FileCoverage),
  weakAreas: Schema.Array(WeakArea),
  linesThresholdGate: Schema.optionalKey(CoverageLinesThresholdGate),
});
export type CoverageReport = typeof CoverageReport.Type;

export const TestContext = Schema.Struct({
  relatedFiles: Schema.Array(TrimmedNonEmptyString),
  imports: Schema.Array(TrimmedNonEmptyString),
  mocks: Schema.Array(TrimmedNonEmptyString),
});
export type TestContext = typeof TestContext.Type;

export const TestGenerationRequest = Schema.Struct({
  targetFile: TrimmedNonEmptyString,
  targetFunction: Schema.optionalKey(TrimmedNonEmptyString),
  type: Schema.Literals(["unit", "integration"]),
  context: Schema.optionalKey(TestContext),
  generateMocks: Schema.Boolean,
  coverageTarget: Schema.Number,
});
export type TestGenerationRequest = typeof TestGenerationRequest.Type;

export const TestGenerationResult = Schema.Struct({
  success: Schema.Boolean,
  testCases: Schema.Array(TestCase),
  generatedCount: Schema.Number,
  estimatedCoverage: Schema.Number,
  error: Schema.optionalKey(Schema.String),
});
export type TestGenerationResult = typeof TestGenerationResult.Type;

export const RegressionTestSelection = Schema.Struct({
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  affectedModules: Schema.Array(TrimmedNonEmptyString),
  selectedTests: Schema.Array(TrimmedNonEmptyString),
  reason: TrimmedNonEmptyString,
  confidence: Schema.Number,
});
export type RegressionTestSelection = typeof RegressionTestSelection.Type;

export const TestRunConfig = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  testPattern: Schema.optionalKey(TrimmedNonEmptyString),
  testFiles: Schema.Array(TrimmedNonEmptyString),
  parallel: Schema.Boolean,
  timeout: Schema.Number,
  environment: Schema.Record(TrimmedNonEmptyString, TrimmedNonEmptyString),
  coverage: Schema.Boolean,
  coverageThreshold: Schema.Number,
  /** 若提供，则 `runTests` 可在该目录下执行 `vitest run`（需本机已安装依赖） */
  workspaceRoot: Schema.optionalKey(Schema.String),
});
export type TestRunConfig = typeof TestRunConfig.Type;

export const TestFailure = Schema.Struct({
  testId: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  stack: Schema.optionalKey(Schema.String),
});
export type TestFailure = typeof TestFailure.Type;

export const TestRunResult = Schema.Struct({
  configId: TrimmedNonEmptyString,
  status: Schema.Literals(["passed", "failed", "timed_out", "error"]),
  duration: Schema.Number,
  testsRun: Schema.Number,
  testsPassed: Schema.Number,
  testsFailed: Schema.Number,
  testsSkipped: Schema.Number,
  failures: Schema.Array(TestFailure),
  coverage: Schema.optionalKey(CoverageReport),
  completedAt: TrimmedNonEmptyString,
});
export type TestRunResult = typeof TestRunResult.Type;
