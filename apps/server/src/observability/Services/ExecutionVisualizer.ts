import { Context, Effect } from "effect";
import type * as Visualization from "@t3tools/contracts";

/**
 * Execution Visualizer Service
 * Provides visualization data for agent execution flows, performance hotspots, and dependencies
 */
export interface ExecutionVisualizer {
  /**
   * Record a new execution event
   */
  recordEvent: (event: Visualization.ExecutionEvent) => Effect.Effect<void, never, never>;

  /**
   * Get all events for a thread
   */
  getTimelineEvents: (
    threadId: Visualization.ThreadId,
  ) => Effect.Effect<Visualization.ExecutionEvent[], never, never>;

  /**
   * Record a decision point
   */
  recordDecisionPoint: (point: Visualization.DecisionPoint) => Effect.Effect<void, never, never>;

  /**
   * Get decision points for a thread
   */
  getDecisionPoints: (
    threadId: Visualization.ThreadId,
  ) => Effect.Effect<Visualization.DecisionPoint[], never, never>;

  /**
   * Calculate performance hotspots based on recorded events
   */
  calculateHotspots: (
    threadId: Visualization.ThreadId,
    thresholdMs?: number,
  ) => Effect.Effect<Visualization.PerformanceHotspot[], never, never>;

  /**
   * Get operation statistics for a thread
   */
  getOperationStats: (
    threadId: Visualization.ThreadId,
  ) => Effect.Effect<Visualization.OperationStats[], never, never>;

  /**
   * Analyze module dependencies
   */
  analyzeDependencies: (rootPath: string) => Effect.Effect<
    {
      nodes: Visualization.DependencyGraphNode[];
      edges: Visualization.ModuleDependency[];
    },
    never,
    never
  >;

  /**
   * Get change impact analysis
   */
  analyzeChangeImpact: (
    changedFiles: string[],
  ) => Effect.Effect<Visualization.VisualizationChangeImpact, never, never>;

  /**
   * Get complete visualization session data
   */
  getSessionData: (
    threadId: Visualization.ThreadId,
  ) => Effect.Effect<Visualization.VisualizationSession | null, never, never>;

  /**
   * Clear visualization data for a thread
   */
  clearSession: (threadId: Visualization.ThreadId) => Effect.Effect<void, never, never>;
}

export const ExecutionVisualizer = Context.Service<ExecutionVisualizer>(
  "provider/Services/ExecutionVisualizer",
);
