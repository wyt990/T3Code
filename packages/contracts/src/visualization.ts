import { Schema } from "effect";
import {
  TurnId,
  EventId,
  ThreadId,
  IsoDateTime,
  TrimmedNonEmptyString,
  NonNegativeInt,
} from "./baseSchemas.ts";

/**
 * Execution Timeline Event
 * Represents a single event in the agent execution flow
 */
export const ExecutionEvent = Schema.Struct({
  id: EventId,
  threadId: ThreadId,
  turnId: TurnId,
  timestamp: IsoDateTime,
  eventType: Schema.Literals([
    "toolCall",
    "toolResult",
    "decisionPoint",
    "fileRead",
    "fileWrite",
    "fileCreate",
    "fileDelete",
    "shellCommand",
    "modelRequest",
    "modelResponse",
  ]),
  category: Schema.optionalKey(TrimmedNonEmptyString),
  durationMs: Schema.optionalKey(NonNegativeInt),
  success: Schema.optionalKey(Schema.Boolean),
  metadata: Schema.optionalKey(Schema.Unknown),
});
export type ExecutionEvent = typeof ExecutionEvent.Type;

/**
 * Decision Point Information
 * Marks where the agent made a choice between alternatives
 */
export const DecisionPoint = Schema.Struct({
  eventId: EventId,
  decisionType: Schema.Literals(["branch", "merge", "loop"]),
  description: TrimmedNonEmptyString,
  alternatives: Schema.Array(TrimmedNonEmptyString),
  chosenPath: TrimmedNonEmptyString,
  reasoning: Schema.optionalKey(TrimmedNonEmptyString),
});
export type DecisionPoint = typeof DecisionPoint.Type;

/**
 * Performance Hotspot
 * Identifies operations that exceed time thresholds
 */
export const PerformanceHotspot = Schema.Struct({
  id: EventId,
  eventType: TrimmedNonEmptyString,
  durationMs: NonNegativeInt,
  thresholdMs: NonNegativeInt,
  severity: Schema.Literals(["warning", "critical"]),
  category: Schema.optionalKey(TrimmedNonEmptyString),
  recommendation: Schema.optionalKey(TrimmedNonEmptyString),
});
export type PerformanceHotspot = typeof PerformanceHotspot.Type;

/**
 * Operation Statistics
 * Aggregated timing data by operation type
 */
export const OperationStats = Schema.Struct({
  operationType: TrimmedNonEmptyString,
  count: NonNegativeInt,
  totalDurationMs: NonNegativeInt,
  averageDurationMs: Schema.Number,
  minDurationMs: NonNegativeInt,
  maxDurationMs: NonNegativeInt,
});
export type OperationStats = typeof OperationStats.Type;

/**
 * Module Dependency
 * Represents a dependency relationship between modules
 */
export const ModuleDependency = Schema.Struct({
  sourceModule: TrimmedNonEmptyString,
  targetModule: TrimmedNonEmptyString,
  dependencyType: Schema.Literals(["import", "reference", "extend", "implement"]),
  isDynamic: Schema.Boolean,
});
export type ModuleDependency = typeof ModuleDependency.Type;

/**
 * Impact Score - a number between 0 and 1
 */
const ImpactScore = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1),
);

/**
 * Dependency Graph Node
 * Represents a module in the dependency graph
 */
export const DependencyGraphNode = Schema.Struct({
  moduleId: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  type: Schema.Literals(["module", "component", "utility", "config", "test"]),
  dependencies: Schema.Array(TrimmedNonEmptyString),
  dependents: Schema.Array(TrimmedNonEmptyString),
  impactScore: ImpactScore,
});
export type DependencyGraphNode = typeof DependencyGraphNode.Type;

/**
 * Change Impact Analysis
 * Shows which modules are affected by changes
 */
export const VisualizationChangeImpact = Schema.Struct({
  changedFiles: Schema.Array(TrimmedNonEmptyString),
  affectedModules: Schema.Array(TrimmedNonEmptyString),
  directImpacts: Schema.Array(DependencyGraphNode),
  transitiveImpacts: Schema.Array(DependencyGraphNode),
  riskLevel: Schema.Literals(["low", "medium", "high", "critical"]),
  summary: TrimmedNonEmptyString,
});
export type VisualizationChangeImpact = typeof VisualizationChangeImpact.Type;

/**
 * Visualization Session State
 * Holds the complete state for a visualization session
 */
export const VisualizationSession = Schema.Struct({
  threadId: ThreadId,
  startTime: IsoDateTime,
  endTime: Schema.optionalKey(IsoDateTime),
  events: Schema.Array(ExecutionEvent),
  decisionPoints: Schema.Array(DecisionPoint),
  hotspots: Schema.Array(PerformanceHotspot),
  operationStats: Schema.Array(OperationStats),
  dependencyGraph: Schema.optionalKey(
    Schema.Struct({
      nodes: Schema.Array(DependencyGraphNode),
      edges: Schema.Array(ModuleDependency),
    }),
  ),
  changeImpacts: Schema.optionalKey(Schema.Array(VisualizationChangeImpact)),
});
export type VisualizationSession = typeof VisualizationSession.Type;
