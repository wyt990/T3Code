import { useMemo } from "react";
import { create } from "zustand";
import type * as V from "@t3tools/contracts";

import { readPrimaryWsRpcClient } from "../rpc/wsClientHelpers";

/** 稳定引用，避免 `?? []` 每次返回新数组触发无限重渲染（React #185）。 */
const EMPTY_EXECUTION_EVENTS: readonly V.ExecutionEvent[] = [];
const EMPTY_HOTSPOTS: readonly V.PerformanceHotspot[] = [];
const EMPTY_OPERATION_STATS: readonly V.OperationStats[] = [];
const EMPTY_DECISION_POINTS: readonly V.DecisionPoint[] = [];

interface VisualizationState {
  // Current session
  currentThreadId: string | null;
  sessionData: V.VisualizationSession | null;

  // View settings
  timelineExpanded: boolean;
  showHotspots: boolean;
  hotspotThresholdMs: number;
  dependencyViewMode: "graph" | "list" | "tree";

  // Filters
  eventFilter: V.ExecutionEvent["eventType"][] | "all";
  timeRange: { start?: string; end?: string };

  // Actions
  setCurrentThread: (threadId: string | null) => void;
  setSessionData: (data: V.VisualizationSession | null) => void;
  toggleTimeline: () => void;
  setShowHotspots: (show: boolean) => void;
  setHotspotThreshold: (threshold: number) => void;
  setDependencyViewMode: (mode: VisualizationState["dependencyViewMode"]) => void;
  setEventFilter: (filter: VisualizationState["eventFilter"]) => void;
  setTimeRange: (range: VisualizationState["timeRange"]) => void;
  clearAll: () => void;
  hydrateFromServer: (threadId: V.ThreadId) => Promise<void>;
}

export const useVisualizationStore = create<VisualizationState>((set, get) => ({
  currentThreadId: null,
  sessionData: null,
  timelineExpanded: true,
  showHotspots: true,
  hotspotThresholdMs: 1000,
  dependencyViewMode: "graph",
  eventFilter: "all",
  timeRange: {},

  setCurrentThread: (threadId) => set({ currentThreadId: threadId, sessionData: null }),
  setSessionData: (data) => set({ sessionData: data }),
  toggleTimeline: () => set((state) => ({ timelineExpanded: !state.timelineExpanded })),
  setShowHotspots: (show) => set({ showHotspots: show }),
  setHotspotThreshold: (threshold) => set({ hotspotThresholdMs: threshold }),
  setDependencyViewMode: (mode) => set({ dependencyViewMode: mode }),
  setEventFilter: (filter) => set({ eventFilter: filter }),
  setTimeRange: (range) => set({ timeRange: range }),
  clearAll: () =>
    set({
      currentThreadId: null,
      sessionData: null,
      timelineExpanded: true,
      showHotspots: true,
      eventFilter: "all",
      timeRange: {},
    }),

  hydrateFromServer: async (threadId) => {
    const client = readPrimaryWsRpcClient();
    if (!client) {
      return;
    }
    try {
      const { session } = await client.visualization.getSessionData({ threadId });
      set({
        currentThreadId: threadId,
        sessionData: session,
      });
    } catch (error) {
      console.error("Failed to load visualization session:", error);
    }
  },
}));

// Selectors
export const useCurrentSession = () => useVisualizationStore((s) => s.sessionData);
export const useTimelineEvents = () => {
  const session = useVisualizationStore((s) => s.sessionData);
  const filter = useVisualizationStore((s) => s.eventFilter);
  return useMemo(() => {
    if (!session?.events) {
      return EMPTY_EXECUTION_EVENTS;
    }
    if (filter === "all") {
      return session.events;
    }
    return session.events.filter((e): e is V.ExecutionEvent => filter.includes(e.eventType));
  }, [session, filter]);
};
export const useHotspots = () =>
  useVisualizationStore((s) => s.sessionData?.hotspots ?? EMPTY_HOTSPOTS);
export const useOperationStats = () =>
  useVisualizationStore((s) => s.sessionData?.operationStats ?? EMPTY_OPERATION_STATS);
export const useDecisionPoints = () =>
  useVisualizationStore((s) => s.sessionData?.decisionPoints ?? EMPTY_DECISION_POINTS);
