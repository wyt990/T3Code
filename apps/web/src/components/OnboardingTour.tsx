"use client";

import { XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";

const STORAGE_KEY = "t3-onboarding-v1-dismissed";

const REPLAY_EVENT = "t3-onboarding-replay";

/** 从设置页等位置重新打开新手引导（无需直接挂载状态）。 */
export function requestOnboardingReplay(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}

const STEPS: ReadonlyArray<{ title: string; lines: readonly string[] }> = [
  {
    title: "欢迎使用 T3 Code",
    lines: [
      "侧边栏底部「工作台」可打开：智能上下文、多代理、可视化、测试、代码质量与环境等面板。",
      "切换会话标签时，智能上下文会随当前激活的服务端会话与工作区联动刷新。",
    ],
  },
  {
    title: "命令面板与自然语言",
    lines: [
      "使用快捷键打开命令面板后，可直接输入中文短语（如「新建对话」「打开设置」「处理 todo」）。",
      "根视图下会展示「最近自然语言」与「与当前项目上下文相关」的快捷项，便于复用。",
    ],
  },
  {
    title: "布局与侧栏面板",
    lines: [
      "工作台 →「布局」可切换开发 / 调试 / 审查等预设，并控制侧栏「上下文」等面板显隐（偏好会持久化）。",
      "完整分步页面高亮与可拖拽可视化布局编辑器仍在规划中；需要时可从本卡片再次查看本简介。",
    ],
  },
];

export function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  const readDismissed = useCallback((): boolean => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return true;
    }
  }, []);

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
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  }, []);

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

  return (
    <div
      className="fixed bottom-4 start-4 z-[60] max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg"
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
  );
}
