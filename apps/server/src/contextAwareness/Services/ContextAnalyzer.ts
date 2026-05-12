/**
 * ContextAnalyzer - Service contract for intelligent context extraction and analysis.
 *
 * Provides interfaces for:
 * - Automatic context extraction from workspace
 * - Smart suggestions based on project state
 * - Change impact analysis
 * - Dependency graph management
 *
 * @module ContextAnalyzer
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";
import {
  ContextAnalysisRequest,
  ContextAnalysisResponse,
  ContextPool,
  SmartSuggestion,
  DependencyGraph,
  ChangeImpact,
  ThreadContext,
  type ProjectId,
} from "@t3tools/contracts";

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class ContextAnalysisError extends Schema.TaggedErrorClass<ContextAnalysisError>()(
  "ContextAnalysisError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return `Context analysis failed: ${this.message}`;
  }
}

export class ContextPoolNotFoundError extends Schema.TaggedErrorClass<ContextPoolNotFoundError>()(
  "ContextPoolNotFoundError",
  {
    projectId: Schema.String,
  },
) {
  override get message(): string {
    return `Context pool not found for project: ${this.projectId}`;
  }
}

export class DependencyGraphBuildError extends Schema.TaggedErrorClass<DependencyGraphBuildError>()(
  "DependencyGraphBuildError",
  {
    workspaceRoot: Schema.String,
    message: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to build dependency graph for ${this.workspaceRoot}: ${this.message}`;
  }
}

export const ContextAnalyzerError = Schema.Union([
  ContextAnalysisError,
  ContextPoolNotFoundError,
  DependencyGraphBuildError,
]);
export type ContextAnalyzerError = typeof ContextAnalyzerError.Type;

// -----------------------------------------------------------------------------
// Service Shape
// -----------------------------------------------------------------------------

/**
 * ContextAnalyzerShape - Service API for intelligent context extraction and analysis.
 */
export interface ContextAnalyzerShape {
  /**
   * Analyze workspace context and generate context pool and suggestions.
   */
  readonly analyzeContext: (
    request: ContextAnalysisRequest,
  ) => Effect.Effect<ContextAnalysisResponse, ContextAnalysisError>;

  /**
   * Get cached context pool for a project.
   */
  readonly getContextPool: (
    projectId: string,
  ) => Effect.Effect<ContextPool, ContextPoolNotFoundError>;

  /**
   * Update context pool with new entries.
   */
  readonly updateContextPool: (
    projectId: string,
    pool: ContextPool,
  ) => Effect.Effect<void, ContextAnalysisError>;

  /**
   * Build dependency graph for workspace.
   */
  readonly buildDependencyGraph: (
    workspaceRoot: string,
  ) => Effect.Effect<DependencyGraph, DependencyGraphBuildError>;

  /**
   * Analyze change impact for a file.
   */
  readonly analyzeChangeImpact: (params: {
    changedFile: string;
    dependencyGraph: DependencyGraph;
    maxReverseImportHops?: number;
  }) => Effect.Effect<ChangeImpact, ContextAnalysisError>;

  /**
   * Get smart suggestions for current thread context.
   */
  readonly getSmartSuggestions: (
    threadContext: ThreadContext,
  ) => Effect.Effect<SmartSuggestion[], ContextAnalysisError>;

  /**
   * Refresh context pool (re-analyze workspace and replace cache).
   */
  readonly refreshContextPool: (
    projectId: string,
    workspaceRoot: string,
  ) => Effect.Effect<ContextPool, ContextAnalysisError>;

  /**
   * 将本会话回合触及的文件合并进缓存中的上下文池（不触发全量扫描）。
   */
  readonly mergeTurnDiffContextEntries: (input: {
    readonly projectId: ProjectId;
    readonly relativePaths: ReadonlyArray<string>;
  }) => Effect.Effect<void, ContextAnalysisError>;
}

// -----------------------------------------------------------------------------
// Service Tag
// -----------------------------------------------------------------------------

/**
 * ContextAnalyzer - Service tag for intelligent context extraction and analysis.
 */
export class ContextAnalyzer extends Context.Service<ContextAnalyzer, ContextAnalyzerShape>()(
  "t3/contextAwareness/Services/ContextAnalyzer",
) {}
