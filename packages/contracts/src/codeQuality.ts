import { Effect, Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

// =============================================================================
// Code Quality Schema
// =============================================================================

export const CodeStyleRule = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  severity: Schema.Literals(["error", "warning", "info"]),
  category: Schema.Literals(["naming", "formatting", "structure", "performance", "security"]),
  enabled: Schema.Boolean,
});
export type CodeStyleRule = typeof CodeStyleRule.Type;

export const CodePattern = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  regex: TrimmedNonEmptyString,
  replacement: Schema.optionalKey(Schema.String),
  category: Schema.Literals(["naming", "formatting", "structure", "performance"]),
});
export type CodePattern = typeof CodePattern.Type;

export const CodeIssue = Schema.Struct({
  id: TrimmedNonEmptyString,
  ruleId: TrimmedNonEmptyString,
  filePath: TrimmedNonEmptyString,
  line: Schema.Number,
  column: Schema.Number,
  message: TrimmedNonEmptyString,
  severity: Schema.Literals(["error", "warning", "info"]),
  category: Schema.Literals(["naming", "formatting", "structure", "performance", "security"]),
  suggestedFix: Schema.optionalKey(Schema.String),
  confidence: Schema.Number,
});
export type CodeIssue = typeof CodeIssue.Type;

export const ProjectStyleProfile = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  patterns: Schema.Array(CodePattern),
  rules: Schema.Array(CodeStyleRule),
  learnedAt: TrimmedNonEmptyString,
  lastUpdated: TrimmedNonEmptyString,
  fileExtensions: Schema.Array(Schema.String),
});
export type ProjectStyleProfile = typeof ProjectStyleProfile.Type;

export const CodeQualityCheckResult = Schema.Struct({
  filePath: TrimmedNonEmptyString,
  issues: Schema.Array(CodeIssue),
  score: Schema.Number,
  checkedAt: TrimmedNonEmptyString,
});
export type CodeQualityCheckResult = typeof CodeQualityCheckResult.Type;

export const BestPracticeChecklistItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  category: TrimmedNonEmptyString,
  required: Schema.Boolean,
  checked: Schema.Boolean,
});
export type BestPracticeChecklistItem = typeof BestPracticeChecklistItem.Type;

export const BestPracticeChecklist = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  items: Schema.Array(BestPracticeChecklistItem),
  createdAt: TrimmedNonEmptyString,
  updatedAt: TrimmedNonEmptyString,
});
export type BestPracticeChecklist = typeof BestPracticeChecklist.Type;

export const TechDebtItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  filePath: TrimmedNonEmptyString,
  line: Schema.Number,
  description: TrimmedNonEmptyString,
  severity: Schema.Literals(["critical", "high", "medium", "low"]),
  category: Schema.Literals(["complexity", "duplication", "outdated", "security", "performance"]),
  estimatedEffort: Schema.Number,
  createdAt: TrimmedNonEmptyString,
});
export type TechDebtItem = typeof TechDebtItem.Type;

export const CodeGenerationContext = Schema.Struct({
  similarFiles: Schema.Array(TrimmedNonEmptyString),
  imports: Schema.Array(TrimmedNonEmptyString),
  patterns: Schema.Array(CodePattern),
});
export type CodeGenerationContext = typeof CodeGenerationContext.Type;

export const CodeGenerationRequest = Schema.Struct({
  prompt: TrimmedNonEmptyString,
  targetFile: Schema.optionalKey(TrimmedNonEmptyString),
  context: Schema.optionalKey(CodeGenerationContext),
  enforceStyle: Schema.Boolean,
  checkQuality: Schema.Boolean,
});
export type CodeGenerationRequest = typeof CodeGenerationRequest.Type;

export const CodeGenerationResult = Schema.Struct({
  success: Schema.Boolean,
  code: Schema.optionalKey(Schema.String),
  issues: Schema.Array(CodeIssue),
  appliedPatterns: Schema.Array(CodePattern),
  qualityScore: Schema.Number,
  error: Schema.optionalKey(Schema.String),
});
export type CodeGenerationResult = typeof CodeGenerationResult.Type;

/** 用户回合发送前：对消息内 Markdown 代码块做静态质检（与 `thread.turn.start` 一并提交）。 */
export const CodeQualityTurnGateMode = Schema.Union([
  Schema.Literal("off"),
  Schema.Literal("warn"),
  Schema.Literal("block"),
]);
export type CodeQualityTurnGateMode = typeof CodeQualityTurnGateMode.Type;

export const ThreadTurnStartCodeQualityGate = Schema.Struct({
  mode: CodeQualityTurnGateMode,
  /** 单段代码块最低分（0–100）；默认 70，由服务端在未传时处理 */
  minScorePerSnippet: Schema.optional(Schema.Number),
});
export type ThreadTurnStartCodeQualityGate = typeof ThreadTurnStartCodeQualityGate.Type;

export const CodeQualityTurnGateDispatchOutcome = Schema.Union([
  Schema.Literal("skipped_mode_off"),
  Schema.Literal("skipped_no_code_blocks"),
  Schema.Literal("skipped_no_thread"),
  Schema.Literal("passed"),
  Schema.Literal("warned"),
]);

/** `orchestration.dispatchCommand` 在带质检闸门时的附加摘要（成功体）。 */
export const CodeQualityTurnGateDispatchSummary = Schema.Struct({
  outcome: CodeQualityTurnGateDispatchOutcome,
  checkedSnippets: Schema.Number,
  lowestScore: Schema.optional(Schema.Number),
  messages: Schema.Array(Schema.String),
});
export type CodeQualityTurnGateDispatchSummary = typeof CodeQualityTurnGateDispatchSummary.Type;
