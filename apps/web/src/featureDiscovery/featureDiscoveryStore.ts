import { create } from "zustand";
import { persist } from "zustand/middleware";

const SNOOZE_KEY = "t3-feature-discovery-snooze";
const TIP_SNOOZE_KEY = "t3-feature-discovery-tip-snooze";

export interface FeatureDiscoveryTip {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** 内置发现队列（按顺序尝试展示，已永久关闭或单条暂延的 id 跳过）。 */
export const FEATURE_DISCOVERY_TIPS: readonly FeatureDiscoveryTip[] = [
  {
    id: "tip-workbench",
    title: "试试「增强工作台」",
    body: "侧栏底部可打开：智能上下文、多代理、可视化、测试、代码质量与布局编排。",
  },
  {
    id: "tip-command-palette",
    title: "命令面板与自然语言",
    body: "默认全局快捷键为 Ctrl+K（Windows/Linux）或 Cmd+K（macOS）；终端输入区获得焦点时不会触发，可先点回聊天或侧栏。打开后支持中文短语（如「打开设置」「新建对话」）。在设置中找到「快捷键」→「打开文件」可编辑持久化绑定；侧栏「搜索」旁也会显示当前快捷键。",
  },
  {
    id: "tip-layout-editor",
    title: "可拖拽侧栏顺序",
    body: "工作台 →「布局」→ 打开「可视化编排」，在同一侧（左/右/底）拖拽面板标题即可调整顺序与宽度。",
  },
  {
    id: "tip-onboarding",
    title: "新手引导可重播",
    body: "设置 → 关于 →「显示新手引导」可随时打开带页面高亮的分步教程。",
  },
];

interface FeatureDiscoveryState {
  readonly permanentlyDismissedIds: readonly string[];
  readonly resetAllDismissals: () => void;
}

function readTipSnoozeMap(): Record<string, number> {
  try {
    const raw =
      typeof window !== "undefined" ? window.sessionStorage.getItem(TIP_SNOOZE_KEY) : null;
    if (raw === null || raw.length === 0) {
      return {};
    }
    const o = JSON.parse(raw) as unknown;
    return typeof o === "object" && o !== null && !Array.isArray(o)
      ? (o as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function writeTipSnoozeMap(map: Record<string, number>): void {
  try {
    window.sessionStorage.setItem(TIP_SNOOZE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/** 清除「稍后 / 知道了」等 session 暂延，供「重置功能发现」与 `resetAllDismissals` 使用。 */
export function clearFeatureDiscoverySessionSnoozes(): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.removeItem(SNOOZE_KEY);
    window.sessionStorage.removeItem(TIP_SNOOZE_KEY);
  } catch {
    // ignore
  }
}

export function snoozeFeatureTip(id: string, ms: number): void {
  const map = readTipSnoozeMap();
  map[id] = Date.now() + ms;
  writeTipSnoozeMap(map);
}

function isTipSnoozed(id: string): boolean {
  return Date.now() < (readTipSnoozeMap()[id] ?? 0);
}

function readSnoozeUntil(): number {
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(SNOOZE_KEY) : null;
    if (raw === null) {
      return 0;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function snoozeFeatureDiscovery(ms: number): void {
  try {
    window.sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + ms));
  } catch {
    // ignore
  }
}

export function isFeatureDiscoverySnoozed(): boolean {
  return Date.now() < readSnoozeUntil();
}

export function pickNextFeatureDiscoveryTip(
  dismissed: ReadonlySet<string>,
): FeatureDiscoveryTip | null {
  if (isFeatureDiscoverySnoozed()) {
    return null;
  }
  for (const tip of FEATURE_DISCOVERY_TIPS) {
    if (dismissed.has(tip.id) || isTipSnoozed(tip.id)) {
      continue;
    }
    return tip;
  }
  return null;
}

export const useFeatureDiscoveryStore = create<FeatureDiscoveryState>()(
  persist(
    (set) => ({
      permanentlyDismissedIds: [],
      resetAllDismissals: () => {
        clearFeatureDiscoverySessionSnoozes();
        set({ permanentlyDismissedIds: [] });
      },
    }),
    {
      name: "t3-feature-discovery-v1",
      partialize: (s) => ({ permanentlyDismissedIds: [...s.permanentlyDismissedIds] }),
    },
  ),
);
