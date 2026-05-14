"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";

import { Button } from "~/components/ui/button";
import {
  pickNextFeatureDiscoveryTip,
  snoozeFeatureDiscovery,
  snoozeFeatureTip,
  useFeatureDiscoveryStore,
} from "./featureDiscoveryStore";

const GLOBAL_SNOOZE_MS = 1000 * 60 * 60 * 8;
const TIP_ACK_SNOOZE_MS = 1000 * 60 * 60 * 24;

function dismissTipPermanent(id: string): void {
  useFeatureDiscoveryStore.setState((state) =>
    state.permanentlyDismissedIds.includes(id)
      ? state
      : { permanentlyDismissedIds: [...state.permanentlyDismissedIds, id] },
  );
}

/**
 * 在适当时机展示一条「功能发现」提示（底部卡片，不阻塞操作）。
 */
export function FeatureDiscoveryHost() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const permanentlyDismissedIds = useFeatureDiscoveryStore((s) => s.permanentlyDismissedIds);

  const dismissedSet = useRef(new Set<string>(permanentlyDismissedIds));
  useEffect(() => {
    dismissedSet.current = new Set(permanentlyDismissedIds);
  }, [permanentlyDismissedIds]);

  const [tip, setTip] = useState<ReturnType<typeof pickNextFeatureDiscoveryTip>>(null);
  const tick = useCallback(() => {
    setTip(pickNextFeatureDiscoveryTip(dismissedSet.current));
  }, []);

  useEffect(() => {
    tick();
  }, [pathname, permanentlyDismissedIds, tick]);

  useEffect(() => {
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [tick]);

  if (tip === null) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 end-4 z-[58] max-w-sm rounded-xl border border-border bg-card p-3 shadow-lg"
      role="status"
    >
      <p className="text-xs font-semibold text-foreground">{tip.title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{tip.body}</p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => {
            snoozeFeatureDiscovery(GLOBAL_SNOOZE_MS);
            setTip(null);
          }}
        >
          稍后
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            dismissTipPermanent(tip.id);
            setTip(null);
          }}
        >
          不再提示
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            snoozeFeatureTip(tip.id, TIP_ACK_SNOOZE_MS);
            setTip(null);
          }}
        >
          知道了
        </Button>
      </div>
    </div>
  );
}
