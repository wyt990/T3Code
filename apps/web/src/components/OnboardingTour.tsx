"use client";

import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { OPEN_FEATURE_WORKBENCH_EVENT } from "../onboardingConstants";

const STORAGE_KEY = "t3-onboarding-v1-dismissed";

const REPLAY_EVENT = "t3-onboarding-replay";

const HIGHLIGHT_CLASSES = [
  "t3-onboarding-highlight",
  "relative",
  "z-[61]",
  "rounded-md",
  "shadow-[0_0_0_4px_rgba(59,130,246,0.65)]",
  "ring-2",
  "ring-primary/90",
] as const;

/** 从设置页等位置重新打开新手引导（无需直接挂载状态）。 */
export function requestOnboardingReplay(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}

type TourStep = {
  readonly title: string;
  readonly lines: readonly string[];
  /** 可选：用于页面高亮的 `querySelector`（`data-t3-onboarding-target` 等）。 */
  readonly highlightSelector?: string;
  readonly showOpenWorkbench?: boolean;
};

const STEPS: readonly TourStep[] = [
  {
    title: "欢迎使用 T3 Code",
    lines: [
      "本引导会在关键界面元素周围显示蓝色描边（页面高亮），帮助你建立空间印象。",
      "可随时跳过；完成后也可在设置 → 关于中再次打开。",
    ],
  },
  {
    title: "增强工作台",
    lines: [
      "侧栏底部的「工作台」打开右侧面板：智能上下文、多代理、可视化、测试、代码质量、环境与布局编排。",
    ],
    highlightSelector: '[data-t3-onboarding-target="sidebar-workbench"]',
  },
  {
    title: "命令面板与侧栏",
    lines: [
      "点击「搜索」或按下全局快捷键，可打开命令面板并尝试自然语言短语。",
      "侧栏底部可进入「设置」；布局偏好与功能发现提示可在对应页面管理。",
    ],
    highlightSelector: '[data-t3-onboarding-target="sidebar-command"]',
  },
  {
    title: "布局与可视化编排",
    lines: [
      "打开工作台后切到「布局」→ 开启「可视化编排」，可在左/右/底分组内拖拽调整侧栏面板顺序，并用滑块调节宽度百分比。",
      "若尚未打开工作台，可点击下方按钮。",
    ],
    showOpenWorkbench: true,
  },
  {
    title: "功能发现提示",
    lines: [
      "首次使用期间，右下角可能弹出简短「功能发现」卡片，可「知道了」「稍后」或「不再提示」。",
      "与新手引导互不冲突；可在设置 → 关于中重置发现队列。",
    ],
  },
];

export function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const highlightedEl = useRef<Element | null>(null);

  const readDismissed = useCallback((): boolean => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return true;
    }
  }, []);

  const clearHighlight = useCallback(() => {
    const el = highlightedEl.current;
    if (el !== null) {
      el.classList.remove(...HIGHLIGHT_CLASSES);
      highlightedEl.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !visible) {
      return;
    }
    const sel = STEPS[step]?.highlightSelector;
    clearHighlight();
    if (sel === undefined || sel.length === 0) {
      return;
    }
    const apply = () => {
      const el = document.querySelector(sel);
      if (!(el instanceof Element)) {
        return;
      }
      highlightedEl.current = el;
      el.classList.add(...HIGHLIGHT_CLASSES);
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    apply();
    const t = window.setTimeout(apply, 280);
    return () => {
      window.clearTimeout(t);
      clearHighlight();
    };
  }, [visible, step, clearHighlight]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (readDismissed()) {
      return;
    }
    setVisible(true);
  }, [readDismissed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onReplay = () => {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      setStep(0);
      setVisible(true);
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, []);

  const dismiss = useCallback(() => {
    clearHighlight();
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  }, [clearHighlight]);

  const replay = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setStep(0);
    setVisible(true);
  }, []);

  if (!visible) {
    return null;
  }

  const content = STEPS[step] ?? STEPS[0]!;
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;
  const hasSpotlight =
    content.highlightSelector !== undefined && content.highlightSelector.length > 0;

  return (
    <>
      {hasSpotlight ? (
        <div className="pointer-events-none fixed inset-0 z-[59] bg-black/35" aria-hidden />
      ) : null}
      <div
        className="fixed bottom-4 start-4 z-[62] max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg"
        role="dialog"
        aria-label="首次使用引导"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              新手引导 {step + 1} / {STEPS.length}
            </p>
            <p className="text-sm font-semibold text-foreground">{content.title}</p>
            <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
              {content.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {content.showOpenWorkbench ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-1"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent(OPEN_FEATURE_WORKBENCH_EVENT));
                }}
              >
                打开增强工作台
              </Button>
            ) : null}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={dismiss}
          >
            <XIcon className="size-4" />
            <span className="sr-only">关闭</span>
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isFirst}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              上一步
            </Button>
            {!isLast ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              >
                下一步
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={dismiss}>
                完成
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={dismiss}
            >
              跳过
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={replay}>
              再次查看
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
