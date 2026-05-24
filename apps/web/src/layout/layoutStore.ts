import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

export type LayoutMode = "development" | "debug" | "review" | "custom";

export interface PanelConfig {
  id: string;
  title: string;
  /** 是否在布局中启用（对「上下文 / 环境 / 多代理」仅表示是否显示标题栏快捷按钮）。 */
  visible: boolean;
  /**
   * 仅用于 `context` / `environment` / `multiAgent` / `fileExplorer`：右侧栏是否展开。
   * 布局标签复选框只改 `visible`；标题栏按钮只改 `railDocked`。缺省视为 `true`。
   */
  railDocked?: boolean;
  width: number; // percentage or pixels
  height: number;
  position: "left" | "right" | "bottom" | "floating";
  order: number;
  collapsed: boolean;
}

/** 标题栏快捷开关与布局复选框绑定的右栏面板（与 `visible` / `railDocked` 拆分语义）。 */
export const RAIL_QUICK_TOGGLE_PANEL_IDS = new Set(["context", "environment", "multiAgent", "fileExplorer"]);

export function isRailQuickTogglePanelId(panelId: string): boolean {
  return RAIL_QUICK_TOGGLE_PANEL_IDS.has(panelId);
}

/** 侧栏 / 底栏是否渲染该面板（含「快捷三件套」的 railDocked 判定）。 */
export function isDockPanelDisplayed(p: PanelConfig): boolean {
  if (!p.visible) {
    return false;
  }
  if (isRailQuickTogglePanelId(p.id)) {
    return p.railDocked !== false;
  }
  return true;
}

export interface LayoutTemplate {
  id: LayoutMode;
  name: string;
  description: string;
  panels: PanelConfig[];
}

const DEFAULT_TEMPLATES: LayoutTemplate[] = [
  {
    id: "development",
    name: "开发模式",
    description: "适合日常编码工作",
    panels: [
      {
        id: "chat",
        title: "对话",
        visible: true,
        width: 30,
        height: 100,
        position: "left",
        order: 0,
        collapsed: false,
      },
      {
        id: "editor",
        title: "编辑器",
        visible: true,
        width: 50,
        height: 100,
        position: "left",
        order: 1,
        collapsed: false,
      },
      {
        id: "context",
        title: "上下文",
        visible: false,
        width: 20,
        height: 100,
        position: "right",
        order: 0,
        collapsed: false,
      },
      {
        id: "environment",
        title: "环境",
        visible: false,
        width: 20,
        height: 100,
        position: "right",
        order: 1,
        collapsed: false,
      },
      {
        id: "multiAgent",
        title: "多代理",
        visible: false,
        width: 25,
        height: 100,
        position: "right",
        order: 2,
        collapsed: false,
      },
      {
        id: "fileExplorer",
        title: "文件",
        visible: false,
        width: 100,
        height: 100,
        position: "right",
        order: 3,
        collapsed: false,
      },
    ],
  },
  {
    id: "debug",
    name: "调试模式",
    description: "适合调试和排查问题",
    panels: [
      {
        id: "chat",
        title: "对话",
        visible: true,
        width: 25,
        height: 100,
        position: "left",
        order: 0,
        collapsed: false,
      },
      {
        id: "editor",
        title: "编辑器",
        visible: true,
        width: 45,
        height: 100,
        position: "left",
        order: 1,
        collapsed: false,
      },
      {
        id: "terminal",
        title: "终端",
        visible: true,
        width: 30,
        height: 100,
        position: "right",
        order: 0,
        collapsed: false,
      },
      {
        id: "visualization",
        title: "可视化",
        visible: true,
        width: 30,
        height: 100,
        position: "bottom",
        order: 0,
        collapsed: false,
      },
      {
        id: "context",
        title: "上下文",
        visible: false,
        width: 20,
        height: 100,
        position: "right",
        order: 1,
        collapsed: false,
      },
      {
        id: "environment",
        title: "环境",
        visible: false,
        width: 20,
        height: 100,
        position: "right",
        order: 2,
        collapsed: false,
      },
      {
        id: "multiAgent",
        title: "多代理",
        visible: false,
        width: 25,
        height: 100,
        position: "right",
        order: 3,
        collapsed: false,
      },
      {
        id: "fileExplorer",
        title: "文件",
        visible: false,
        width: 100,
        height: 100,
        position: "right",
        order: 4,
        collapsed: false,
      },
    ],
  },
  {
    id: "review",
    name: "审查模式",
    description: "适合代码审查",
    panels: [
      {
        id: "chat",
        title: "对话",
        visible: true,
        width: 20,
        height: 100,
        position: "left",
        order: 0,
        collapsed: false,
      },
      {
        id: "diff",
        title: "差异对比",
        visible: true,
        width: 60,
        height: 100,
        position: "left",
        order: 1,
        collapsed: false,
      },
      {
        id: "comments",
        title: "评论",
        visible: true,
        width: 20,
        height: 100,
        position: "right",
        order: 0,
        collapsed: false,
      },
      {
        id: "testing",
        title: "测试",
        visible: false,
        width: 30,
        height: 100,
        position: "bottom",
        order: 0,
        collapsed: false,
      },
      {
        id: "context",
        title: "上下文",
        visible: false,
        width: 20,
        height: 100,
        position: "right",
        order: 1,
        collapsed: false,
      },
      {
        id: "environment",
        title: "环境",
        visible: false,
        width: 20,
        height: 100,
        position: "right",
        order: 2,
        collapsed: false,
      },
      {
        id: "multiAgent",
        title: "多代理",
        visible: false,
        width: 25,
        height: 100,
        position: "right",
        order: 3,
        collapsed: false,
      },
      {
        id: "fileExplorer",
        title: "文件",
        visible: false,
        width: 100,
        height: 100,
        position: "right",
        order: 4,
        collapsed: false,
      },
    ],
  },
];

interface LayoutState {
  // Current layout
  currentMode: LayoutMode;
  panels: PanelConfig[];
  templates: LayoutTemplate[];
  customLayouts: LayoutTemplate[];

  // Loading
  isLoading: boolean;

  // Actions
  setCurrentMode: (mode: LayoutMode) => void;
  applyTemplate: (templateId: LayoutMode) => void;
  updatePanel: (panelId: string, updates: Partial<PanelConfig>) => void;
  togglePanel: (panelId: string) => void;
  movePanel: (panelId: string, newPosition: PanelConfig["position"]) => void;
  /** 在同一 `position` 分组内调整顺序（用于可视化拖拽编排）。 */
  reorderPanelsAtPosition: (
    position: PanelConfig["position"],
    fromIndex: number,
    toIndex: number,
  ) => void;
  resizePanel: (panelId: string, width: number, height: number) => void;
  saveCustomLayout: (name: string, description: string) => void;
  deleteCustomLayout: (layoutId: string) => void;
  resetToDefault: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      // Initial State
      currentMode: "development",
      panels: DEFAULT_TEMPLATES.at(0)?.panels ?? [],
      templates: DEFAULT_TEMPLATES,
      customLayouts: [],
      isLoading: false,

      // Actions
      setCurrentMode: (mode) => {
        const template =
          DEFAULT_TEMPLATES.find((t) => t.id === mode) ||
          get().customLayouts.find((t) => t.id === mode);
        if (template) {
          set({ currentMode: mode, panels: [...template.panels] });
        } else {
          set({ currentMode: mode });
        }
      },

      applyTemplate: (templateId) => {
        const template =
          DEFAULT_TEMPLATES.find((t) => t.id === templateId) ||
          get().customLayouts.find((t) => t.id === templateId);
        if (template) {
          set({ panels: [...template.panels], currentMode: templateId });
        }
      },

      updatePanel: (panelId, updates) => {
        set((state) => ({
          panels: state.panels.map((p) => (p.id === panelId ? { ...p, ...updates } : p)),
        }));
      },

      togglePanel: (panelId) => {
        set((state) => ({
          panels: state.panels.map((p) => (p.id === panelId ? { ...p, visible: !p.visible } : p)),
        }));
      },

      movePanel: (panelId, newPosition) => {
        set((state) => ({
          panels: state.panels.map((p) => (p.id === panelId ? { ...p, position: newPosition } : p)),
        }));
      },

      reorderPanelsAtPosition: (position, fromIndex, toIndex) => {
        set((state) => {
          const atPos = state.panels
            .filter((p) => p.position === position)
            .toSorted((a, b) => a.order - b.order);
          if (
            fromIndex < 0 ||
            fromIndex >= atPos.length ||
            toIndex < 0 ||
            toIndex >= atPos.length
          ) {
            return state;
          }
          const next = [...atPos];
          const [moved] = next.splice(fromIndex, 1);
          if (moved === undefined) {
            return state;
          }
          next.splice(toIndex, 0, moved);
          const orderById = new Map(next.map((p, i) => [p.id, i] as const));
          return {
            panels: state.panels.map((p) =>
              orderById.has(p.id) ? { ...p, order: orderById.get(p.id)! } : p,
            ),
          };
        });
      },

      resizePanel: (panelId, width, height) => {
        set((state) => ({
          panels: state.panels.map((p) => (p.id === panelId ? { ...p, width, height } : p)),
        }));
      },

      saveCustomLayout: (name, description) => {
        const newLayout: LayoutTemplate = {
          id: `custom-${Date.now()}` as LayoutMode,
          name,
          description,
          panels: [...get().panels],
        };
        set((state) => ({
          customLayouts: [...state.customLayouts, newLayout],
        }));
      },

      deleteCustomLayout: (layoutId) => {
        set((state) => ({
          customLayouts: state.customLayouts.filter((l) => l.id !== layoutId),
        }));
      },

      resetToDefault: () => {
        const defaultPanels = DEFAULT_TEMPLATES.at(0)?.panels ?? [];
        set({
          currentMode: "development",
          panels: defaultPanels,
        });
      },
    }),
    {
      name: "t3-layout-preferences",
      partialize: (state) => ({
        currentMode: state.currentMode,
        panels: state.panels,
        customLayouts: state.customLayouts,
      }),
      // 确保新增的默认面板（如 fileExplorer）能合并到旧的持久化数据中
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<LayoutState>) };
        if (merged.panels) {
          const defaultPanels = DEFAULT_TEMPLATES.at(0)?.panels ?? [];
          const existingIds = new Set(merged.panels.map((p) => p.id));
          for (const dp of defaultPanels) {
            if (!existingIds.has(dp.id)) {
              merged.panels = [...merged.panels, dp];
            }
          }
        }
        return merged;
      },
    },
  ),
);

// Selectors
export const useCurrentLayout = () =>
  useLayoutStore(
    useShallow((s) => ({
      mode: s.currentMode,
      panels: s.panels,
    })),
  );

export const useVisiblePanels = () => useLayoutStore((s) => s.panels.filter(isDockPanelDisplayed));

export const usePanelById = (panelId: string) =>
  useLayoutStore((s) => s.panels.find((p) => p.id === panelId));

export const useLayoutTemplates = () =>
  useLayoutStore(useShallow((s) => [...s.templates, ...s.customLayouts]));
