/**
 * Context awareness schemas for intelligent context extraction and analysis.
 *
 * @module context
 */
import { Schema } from "effect";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

// -----------------------------------------------------------------------------
// Context Types
// -----------------------------------------------------------------------------

export const ContextSourceType = Schema.Literals([
  "file",
  "git-diff",
  "todo-comment",
  "fixme-comment",
  "architecture-decision",
  "core-module",
  /** 代理回合 diff 推断出的本会话触及文件（增量上下文池） */
  "session-touch",
]);
export type ContextSourceType = typeof ContextSourceType.Type;

export const ContextSource = Schema.Struct({
  type: ContextSourceType,
  path: TrimmedNonEmptyString,
  content: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type ContextSource = typeof ContextSource.Type;

export const ContextPriority = Schema.Literals(["critical", "high", "medium", "low"]);
export type ContextPriority = typeof ContextPriority.Type;

export const ContextEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  source: ContextSource,
  priority: ContextPriority,
  relevanceScore: Schema.Number,
  lastUpdated: Schema.String, // ISO timestamp
});
export type ContextEntry = typeof ContextEntry.Type;

// -----------------------------------------------------------------------------
// Context Pool
// -----------------------------------------------------------------------------

export const ContextPool = Schema.Struct({
  projectId: ProjectId,
  entries: Schema.Array(ContextEntry),
  lastRefreshed: Schema.String, // ISO timestamp
});
export type ContextPool = typeof ContextPool.Type;

// -----------------------------------------------------------------------------
// Smart Suggestions
// -----------------------------------------------------------------------------

export const SuggestionType = Schema.Literals([
  "todo-batch",
  "commit-prompt",
  "test-suggestion",
  "refactor-suggestion",
  "dependency-update",
]);
export type SuggestionType = typeof SuggestionType.Type;

export const SmartSuggestion = Schema.Struct({
  id: TrimmedNonEmptyString,
  type: SuggestionType,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  action: TrimmedNonEmptyString, // Action identifier
  context: Schema.optionalKey(Schema.Array(ContextEntry)),
  priority: ContextPriority,
});
export type SmartSuggestion = typeof SmartSuggestion.Type;

// -----------------------------------------------------------------------------
// Change Impact Analysis
// -----------------------------------------------------------------------------

export const DependencyNode = Schema.Struct({
  id: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  type: Schema.Literals(["module", "file", "component", "service"]),
  imports: Schema.Array(TrimmedNonEmptyString),
  exports: Schema.Array(TrimmedNonEmptyString),
});
export type DependencyNode = typeof DependencyNode.Type;

export const DependencyEdge = Schema.Struct({
  from: TrimmedNonEmptyString,
  to: TrimmedNonEmptyString,
  type: Schema.Literals(["import", "reference", "dependency"]),
});
export type DependencyEdge = typeof DependencyEdge.Type;

export const DependencyGraph = Schema.Struct({
  nodes: Schema.Array(DependencyNode),
  edges: Schema.Array(DependencyEdge),
  lastUpdated: Schema.String, // ISO timestamp
});
export type DependencyGraph = typeof DependencyGraph.Type;

export const ImpactLevel = Schema.Literals(["critical", "high", "medium", "low", "none"]);
export type ImpactLevel = typeof ImpactLevel.Type;

export const ChangeImpact = Schema.Struct({
  changedFile: TrimmedNonEmptyString,
  /** 直接 import 该文件的模块（一层反向边） */
  affectedFiles: Schema.Array(TrimmedNonEmptyString),
  /** 传递性 import 方（不含直接层；与 affectedFiles 并集为总影响面） */
  transitiveImporters: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  /** 本次分析使用的最大反向跳数（含直接层为 1） */
  impactHopDepth: Schema.optionalKey(Schema.Number),
  impactLevel: ImpactLevel,
  riskReasons: Schema.Array(Schema.String),
});
export type ChangeImpact = typeof ChangeImpact.Type;

// -----------------------------------------------------------------------------
// Context Analysis Request/Response
// -----------------------------------------------------------------------------

export const ContextAnalysisRequest = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  options: Schema.optionalKey(
    Schema.Struct({
      includeGitDiff: Schema.Boolean,
      includeTodoComments: Schema.Boolean,
      includeCoreModules: Schema.Boolean,
      /** 与上游分支（@{u}）对比的变更文件列表；默认 true。 */
      includeBranchDelta: Schema.optional(Schema.Boolean),
      maxEntries: Schema.Number,
      /** 构建 import 依赖图时最多扫描的 .ts/.tsx 文件数；默认 160。 */
      maxDependencyScanFiles: Schema.optional(Schema.Number),
    }),
  ),
});
export type ContextAnalysisRequest = typeof ContextAnalysisRequest.Type;

export const ContextAnalysisResponse = Schema.Struct({
  contextPool: ContextPool,
  suggestions: Schema.Array(SmartSuggestion),
  dependencyGraph: Schema.optionalKey(DependencyGraph),
});
export type ContextAnalysisResponse = typeof ContextAnalysisResponse.Type;

// -----------------------------------------------------------------------------
// Thread Context
// -----------------------------------------------------------------------------

export const ThreadContext = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  activeFiles: Schema.Array(TrimmedNonEmptyString),
  recentChanges: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      changeType: Schema.Literals(["added", "modified", "deleted"]),
      timestamp: Schema.String,
    }),
  ),
  focusArea: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ThreadContext = typeof ThreadContext.Type;

/** 基于 import 依赖图分析单文件变更的反向影响（谁导入了该文件）。 */
export const ContextChangeImpactRequest = Schema.Struct({
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  /** 相对工作区根的路径，与依赖图节点 `path` 一致（例如 `apps/server/src/foo.ts`） */
  changedFile: TrimmedNonEmptyString,
  /**
   * 反向 import 影响的最大跳数（默认 2：直接 + 一层传递）。
   * 设为 1 时仅返回直接 import 方。
   */
  maxReverseImportHops: Schema.optional(Schema.Number),
});
export type ContextChangeImpactRequest = typeof ContextChangeImpactRequest.Type;
