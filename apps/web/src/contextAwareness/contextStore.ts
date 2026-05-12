import { create } from "zustand";
import type {
  ContextEntry,
  SmartSuggestion,
  DependencyGraph,
  ChangeImpact,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

import { readPrimaryWsRpcClient } from "../rpc/wsClientHelpers";

interface ContextState {
  // Context Pool
  contextEntries: ContextEntry[];
  isContextLoading: boolean;
  lastContextRefresh: string | null;

  // Smart Suggestions
  suggestions: SmartSuggestion[];
  activeSuggestion: SmartSuggestion | null;

  // Dependency Graph
  dependencyGraph: DependencyGraph | null;
  isGraphLoading: boolean;

  // Change Impact Analysis
  changeImpact: ChangeImpact | null;
  pendingAnalysisFile: string | null;
  isImpactAnalyzing: boolean;

  // Actions
  setContextEntries: (entries: ContextEntry[]) => void;
  addContextEntry: (entry: ContextEntry) => void;
  removeContextEntry: (id: string) => void;
  setSuggestions: (suggestions: SmartSuggestion[]) => void;
  activateSuggestion: (suggestion: SmartSuggestion | null) => void;
  setDependencyGraph: (graph: DependencyGraph | null) => void;
  setChangeImpact: (impact: ChangeImpact | null) => void;
  setPendingAnalysisFile: (file: string | null) => void;
  clearContext: () => void;
  refreshContext: (
    projectId: ProjectId,
    workspaceRoot: string,
    session?: { threadId: ThreadId; environmentId: EnvironmentId } | null,
  ) => Promise<void>;
  analyzeChangeImpact: (
    projectId: ProjectId,
    workspaceRoot: string,
    changedFile: string,
    maxReverseImportHops?: number,
  ) => Promise<void>;
}

export const useContextStore = create<ContextState>((set, get) => ({
  // Initial State
  contextEntries: [],
  isContextLoading: false,
  lastContextRefresh: null,
  suggestions: [],
  activeSuggestion: null,
  dependencyGraph: null,
  isGraphLoading: false,
  changeImpact: null,
  pendingAnalysisFile: null,
  isImpactAnalyzing: false,

  // Actions
  setContextEntries: (entries) => set({ contextEntries: entries }),
  addContextEntry: (entry) =>
    set((state) => ({
      contextEntries: [...state.contextEntries, entry],
    })),
  removeContextEntry: (id) =>
    set((state) => ({
      contextEntries: state.contextEntries.filter((e) => e.id !== id),
    })),
  setSuggestions: (suggestions) => set({ suggestions }),
  activateSuggestion: (suggestion) => set({ activeSuggestion: suggestion }),
  setDependencyGraph: (graph) => set({ dependencyGraph: graph }),
  setChangeImpact: (impact) => set({ changeImpact: impact }),
  setPendingAnalysisFile: (file) => set({ pendingAnalysisFile: file }),

  clearContext: () =>
    set({
      contextEntries: [],
      suggestions: [],
      activeSuggestion: null,
      dependencyGraph: null,
      changeImpact: null,
      pendingAnalysisFile: null,
      lastContextRefresh: null,
      isContextLoading: false,
      isGraphLoading: false,
      isImpactAnalyzing: false,
    }),

  refreshContext: async (projectId, workspaceRoot, session) => {
    const client = readPrimaryWsRpcClient();
    set({ isContextLoading: true });
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const result = await client.context.analyze({
        projectId,
        workspaceRoot,
        options: {
          includeGitDiff: true,
          includeTodoComments: true,
          includeCoreModules: true,
          includeBranchDelta: true,
          maxEntries: 500,
          maxDependencyScanFiles: 200,
        },
      });

      let mergedSuggestions = [...result.suggestions];
      if (session) {
        const pathOrder: string[] = [];
        const seenPath = new Set<string>();
        for (const e of result.contextPool.entries) {
          const p = e.source.path;
          if (seenPath.has(p)) {
            continue;
          }
          seenPath.add(p);
          pathOrder.push(p);
          if (pathOrder.length >= 32) {
            break;
          }
        }
        const recentChanges = result.contextPool.entries
          .filter((e) => e.source.type === "git-diff")
          .slice(0, 60)
          .map((e) => ({
            path: e.source.path,
            changeType: "modified" as const,
            timestamp: e.lastUpdated,
          }));
        try {
          const threadSmart = await client.context.getSmartSuggestions({
            threadId: session.threadId,
            projectId,
            activeFiles: pathOrder,
            recentChanges,
          });
          const seenIds = new Set(mergedSuggestions.map((s) => s.id));
          for (const s of threadSmart.suggestions) {
            if (!seenIds.has(s.id)) {
              seenIds.add(s.id);
              mergedSuggestions.push(s);
            }
          }
        } catch (threadErr) {
          console.warn("getSmartSuggestions failed (non-fatal):", threadErr);
        }
      }

      set({
        contextEntries: [...result.contextPool.entries],
        suggestions: mergedSuggestions,
        dependencyGraph: result.dependencyGraph ?? null,
        lastContextRefresh: result.contextPool.lastRefreshed,
        isContextLoading: false,
      });
    } catch (error) {
      set({ isContextLoading: false });
      console.error("Failed to refresh context:", error);
    }
  },

  analyzeChangeImpact: async (projectId, workspaceRoot, changedFile, maxReverseImportHops) => {
    const client = readPrimaryWsRpcClient();
    const trimmed = changedFile.trim();
    if (trimmed.length === 0) {
      return;
    }
    set({ isImpactAnalyzing: true });
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const impact = await client.context.analyzeChangeImpact({
        projectId,
        workspaceRoot,
        changedFile: trimmed,
        maxReverseImportHops: maxReverseImportHops ?? 2,
      });
      set({ changeImpact: impact, isImpactAnalyzing: false });
    } catch (error) {
      set({ isImpactAnalyzing: false });
      console.error("Failed to analyze change impact:", error);
    }
  },
}));

// Selector hooks for optimized component updates
export const useContextEntries = () => useContextStore((s) => s.contextEntries);
export const useSuggestions = () => useContextStore((s) => s.suggestions);
export const useDependencyGraph = () => useContextStore((s) => s.dependencyGraph);
export const useChangeImpact = () => useContextStore((s) => s.changeImpact);
export const useActiveSuggestion = () => useContextStore((s) => s.activeSuggestion);
export const useContextLoading = () => useContextStore((s) => s.isContextLoading);
export const useImpactAnalyzing = () => useContextStore((s) => s.isImpactAnalyzing);
