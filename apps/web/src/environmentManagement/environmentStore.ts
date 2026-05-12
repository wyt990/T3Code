import { create } from "zustand";
import type {
  EnvironmentTemplate,
  EnvironmentProfile,
  ConfigDiff,
  DependencyTree,
  DependencyUpdateSuggestion,
  DependencyAuditFinding,
  EnvironmentId,
} from "@t3tools/contracts";

import { readPrimaryWsRpcClient } from "../rpc/wsClientHelpers";

interface EnvironmentState {
  // Templates
  templates: EnvironmentTemplate[];
  selectedTemplate: EnvironmentTemplate | null;

  // Profiles
  profiles: EnvironmentProfile[];
  activeProfile: EnvironmentProfile | null;

  // Config Diff
  configDiff: ConfigDiff | null;

  // Dependencies
  dependencyTree: DependencyTree | null;
  updateSuggestions: DependencyUpdateSuggestion[];
  auditFindings: DependencyAuditFinding[];

  // Loading States
  isTemplatesLoading: boolean;
  isProfilesLoading: boolean;
  isDependenciesLoading: boolean;

  // Actions
  setTemplates: (templates: EnvironmentTemplate[]) => void;
  selectTemplate: (template: EnvironmentTemplate | null) => void;
  setProfiles: (profiles: EnvironmentProfile[]) => void;
  setActiveProfile: (profile: EnvironmentProfile | null) => void;
  setConfigDiff: (diff: ConfigDiff | null) => void;
  setDependencyTree: (tree: DependencyTree | null) => void;
  setUpdateSuggestions: (suggestions: DependencyUpdateSuggestion[]) => void;
  setAuditFindings: (findings: DependencyAuditFinding[]) => void;
  createProfile: (name: string, templateId?: string) => Promise<void>;
  switchEnvironment: (environmentId: string) => Promise<void>;
  refreshDependencies: (workspaceRoot: string) => Promise<void>;
  fetchProfiles: () => Promise<void>;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  // Initial State
  templates: [],
  selectedTemplate: null,
  profiles: [],
  activeProfile: null,
  configDiff: null,
  dependencyTree: null,
  updateSuggestions: [],
  auditFindings: [],
  isTemplatesLoading: false,
  isProfilesLoading: false,
  isDependenciesLoading: false,

  // Actions
  setTemplates: (templates) => set({ templates }),
  selectTemplate: (template) => set({ selectedTemplate: template }),
  setProfiles: (profiles) => set({ profiles }),
  setActiveProfile: (profile) => set({ activeProfile: profile }),
  setConfigDiff: (diff) => set({ configDiff: diff }),
  setDependencyTree: (tree) => set({ dependencyTree: tree }),
  setUpdateSuggestions: (suggestions) => set({ updateSuggestions: suggestions }),
  setAuditFindings: (findings) => set({ auditFindings: findings }),

  createProfile: async (name: string, templateId?: string) => {
    const client = readPrimaryWsRpcClient();
    set({ isProfilesLoading: true });
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const createPayload = templateId !== undefined ? { name, templateId } : { name };
      const newProfile = await client.environmentProfiles.create(createPayload);
      set((state) => ({
        profiles: [...state.profiles.filter((p) => p.id !== newProfile.id), newProfile],
        activeProfile: newProfile,
        isProfilesLoading: false,
      }));
    } catch (error) {
      set({ isProfilesLoading: false });
      console.error("Failed to create profile:", error);
    }
  },

  switchEnvironment: async (environmentId: string) => {
    const { activeProfile } = get();
    if (!activeProfile) return;

    const client = readPrimaryWsRpcClient();
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const updatedProfile = await client.environmentProfiles.update({
        profileId: activeProfile.id,
        activeEnvironmentId: environmentId as EnvironmentId,
      });
      set({
        activeProfile: updatedProfile,
        profiles: get().profiles.map((p) => (p.id === updatedProfile.id ? updatedProfile : p)),
      });
    } catch (error) {
      console.error("Failed to switch environment:", error);
    }
  },

  refreshDependencies: async (workspaceRoot: string) => {
    const root = workspaceRoot.trim();
    const client = readPrimaryWsRpcClient();
    if (!root || !client) {
      set({ isDependenciesLoading: false });
      return;
    }
    set({ isDependenciesLoading: true });
    try {
      const { tree, suggestions, auditFindings } =
        await client.environmentProfiles.refreshDependencyInsights({
          workspaceRoot: root,
        });
      set({
        dependencyTree: tree,
        updateSuggestions: [...suggestions],
        auditFindings: [...auditFindings],
        isDependenciesLoading: false,
      });
    } catch (error) {
      console.error("Failed to refresh dependencies:", error);
      set({ isDependenciesLoading: false });
    }
  },

  fetchProfiles: async () => {
    const client = readPrimaryWsRpcClient();
    set({ isProfilesLoading: true });
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const { environments } = await client.environmentProfiles.list();
      set({
        profiles: [...environments],
        activeProfile: environments[0] ?? null,
        isProfilesLoading: false,
      });
    } catch (error) {
      set({ isProfilesLoading: false });
      console.error("Failed to fetch environment profiles:", error);
    }
  },
}));

// Selectors
export const useEnvironmentTemplates = () => useEnvironmentStore((s) => s.templates);
export const useEnvironmentProfiles = () => useEnvironmentStore((s) => s.profiles);
export const useActiveEnvironmentProfile = () => useEnvironmentStore((s) => s.activeProfile);
export const useEnvironmentConfigDiff = () => useEnvironmentStore((s) => s.configDiff);
export const useDependencyTree = () => useEnvironmentStore((s) => s.dependencyTree);
export const useDependencyUpdateSuggestions = () => useEnvironmentStore((s) => s.updateSuggestions);
export const useDependencyAuditFindings = () => useEnvironmentStore((s) => s.auditFindings);
