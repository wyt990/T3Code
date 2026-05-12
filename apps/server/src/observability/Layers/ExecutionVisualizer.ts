import { Context, Effect, Layer } from "effect";
import * as V from "@t3tools/contracts";
import { ExecutionVisualizer } from "../Services/ExecutionVisualizer.ts";

/**
 * Default threshold for marking an operation as a hotspot (in milliseconds)
 */
const DEFAULT_HOTSPOT_THRESHOLD_MS = 1000;

/**
 * Live implementation of ExecutionVisualizer
 * Uses in-memory storage for visualization data
 */
export const liveExecutionVisualizer: Layer.Layer<ExecutionVisualizer, never> = Layer.effect(
  ExecutionVisualizer,
  Effect.gen(function* () {
    // In-memory storage using standard Maps
    const eventsByThread = new Map<V.ThreadId, V.ExecutionEvent[]>();
    const decisionPointsByThread = new Map<V.ThreadId, V.DecisionPoint[]>();
    const sessionData = new Map<V.ThreadId, Partial<V.VisualizationSession>>();

    const recordEvent: ExecutionVisualizer["recordEvent"] = (event: V.ExecutionEvent) =>
      Effect.gen(function* () {
        const threadId = event.threadId;
        const currentEvents = eventsByThread.get(threadId) ?? [];
        const updated = [...currentEvents, event];
        eventsByThread.set(threadId, updated);
      });

    const getTimelineEvents: ExecutionVisualizer["getTimelineEvents"] = (threadId: V.ThreadId) =>
      Effect.succeed(eventsByThread.get(threadId) ?? []);

    const recordDecisionPoint: ExecutionVisualizer["recordDecisionPoint"] = (
      point: V.DecisionPoint,
    ) =>
      Effect.gen(function* () {
        // Note: DecisionPoint uses eventId as identifier, we store under same key cast to ThreadId
        const id = point.eventId;
        const existing = decisionPointsByThread.get(id as unknown as V.ThreadId) ?? [];
        decisionPointsByThread.set(id as unknown as V.ThreadId, [...existing, point]);
      });

    const getDecisionPoints: ExecutionVisualizer["getDecisionPoints"] = (threadId: V.ThreadId) =>
      Effect.succeed(decisionPointsByThread.get(threadId) ?? []);

    const calculateHotspots: ExecutionVisualizer["calculateHotspots"] = (
      threadId: V.ThreadId,
      thresholdMs: number = DEFAULT_HOTSPOT_THRESHOLD_MS,
    ) =>
      Effect.gen(function* () {
        const events = yield* getTimelineEvents(threadId);
        const hotspots: V.PerformanceHotspot[] = [];

        for (const event of events) {
          if (event.durationMs && event.durationMs > thresholdMs) {
            const severity = event.durationMs > thresholdMs * 3 ? "critical" : "warning";
            const hotspot: V.PerformanceHotspot = {
              id: event.id,
              eventType: event.eventType,
              durationMs: event.durationMs,
              thresholdMs,
              severity,
              recommendation: getSuggestionForEventType(event.eventType),
            };
            const hotspotWithCategory = Object.assign(
              {},
              hotspot,
              event.category !== undefined ? { category: event.category } : {},
            );
            hotspots.push(hotspotWithCategory);
          }
        }

        return hotspots;
      });

    const getOperationStats: ExecutionVisualizer["getOperationStats"] = (threadId: V.ThreadId) =>
      Effect.gen(function* () {
        const events = yield* getTimelineEvents(threadId);
        const statsByType = new Map<
          string,
          { count: number; totalDuration: number; durations: number[] }
        >();

        for (const event of events) {
          const type = event.eventType;
          const current = statsByType.get(type) ?? { count: 0, totalDuration: 0, durations: [] };
          current.count++;
          if (event.durationMs) {
            current.totalDuration += event.durationMs;
            current.durations.push(event.durationMs);
          }
          statsByType.set(type, current);
        }

        const stats: V.OperationStats[] = Array.from(statsByType.entries()).map(
          ([operationType, data]) => ({
            operationType,
            count: data.count,
            totalDurationMs: data.totalDuration,
            averageDurationMs:
              data.durations.length > 0 ? data.totalDuration / data.durations.length : 0,
            minDurationMs: Math.min(...data.durations, 0),
            maxDurationMs: Math.max(...data.durations, 0),
          }),
        );

        return stats.sort((a, b) => b.totalDurationMs - a.totalDurationMs);
      });

    const analyzeDependencies: ExecutionVisualizer["analyzeDependencies"] = (rootPath: string) =>
      Effect.gen(function* () {
        // TODO: Implement actual dependency analysis
        // For now, return empty result
        return { nodes: [], edges: [] };
      });

    const analyzeChangeImpact: ExecutionVisualizer["analyzeChangeImpact"] = (
      changedFiles: string[],
    ) =>
      Effect.gen(function* () {
        // TODO: Implement change impact analysis
        // For now, return basic result
        return {
          changedFiles,
          affectedModules: [],
          directImpacts: [],
          transitiveImpacts: [],
          riskLevel: "low",
          summary: `Analyzed ${changedFiles.length} changed files`,
        };
      });

    const getSessionData: ExecutionVisualizer["getSessionData"] = (threadId: V.ThreadId) =>
      Effect.gen(function* () {
        const cached = sessionData.get(threadId);
        if (cached && Object.keys(cached).length > 0) {
          return cached as V.VisualizationSession | null;
        }

        const events = yield* getTimelineEvents(threadId);
        if (events.length === 0) {
          return null;
        }

        const decisionPoints = yield* getDecisionPoints(threadId);
        const hotspots = yield* calculateHotspots(threadId);
        const operationStats = yield* getOperationStats(threadId);

        const session: V.VisualizationSession = {
          threadId,
          startTime: events[0]!.timestamp,
          endTime: events[events.length - 1]!.timestamp,
          events,
          decisionPoints,
          hotspots,
          operationStats,
        };

        sessionData.set(threadId, session);
        return session;
      });

    const clearSession: ExecutionVisualizer["clearSession"] = (threadId: V.ThreadId) =>
      Effect.gen(function* () {
        eventsByThread.delete(threadId);
        decisionPointsByThread.delete(threadId);
        sessionData.delete(threadId);
      });

    return {
      recordEvent,
      getTimelineEvents,
      recordDecisionPoint,
      getDecisionPoints,
      calculateHotspots,
      getOperationStats,
      analyzeDependencies,
      analyzeChangeImpact,
      getSessionData,
      clearSession,
    };
  }),
);

/**
 * Get suggestion for slow operation types
 */
function getSuggestionForEventType(eventType: V.ExecutionEvent["eventType"]): string {
  const suggestions: Record<V.ExecutionEvent["eventType"], string> = {
    toolCall: "Consider caching tool results or batching similar calls",
    toolResult: "Check if tool response can be processed more efficiently",
    decisionPoint: "Review decision logic for optimization opportunities",
    fileRead: "Use selective file reading or caching for frequently accessed files",
    fileWrite: "Batch file writes or use async operations",
    fileCreate: "Verify file creation is necessary before execution",
    fileDelete: "Ensure deletion is required and consider archiving instead",
    shellCommand: "Optimize shell command or parallelize independent commands",
    modelRequest: "Reduce prompt size or use more efficient model endpoints",
    modelResponse: "Stream responses or process incrementally",
  };
  return suggestions[eventType] || "Review operation for potential optimizations";
}
