import type { ThreadTurnStartCodeQualityGate } from "@t3tools/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TurnStartGateMode = ThreadTurnStartCodeQualityGate["mode"];

interface CodeQualityGateState {
  turnStartGateMode: TurnStartGateMode;
  minScorePerSnippet: number;
  setTurnStartGateMode: (mode: TurnStartGateMode) => void;
  setMinScorePerSnippet: (value: number) => void;
}

export const useCodeQualityGateStore = create<CodeQualityGateState>()(
  persist(
    (set) => ({
      turnStartGateMode: "off",
      minScorePerSnippet: 70,
      setTurnStartGateMode: (mode) => set({ turnStartGateMode: mode }),
      setMinScorePerSnippet: (value) =>
        set({
          minScorePerSnippet: Math.max(0, Math.min(100, Math.round(value))),
        }),
    }),
    { name: "t3code-code-quality-turn-gate" },
  ),
);

/** 供发送回合时拼入 `thread.turn.start.codeQualityGate`（关闭时不传）。 */
export function buildTurnStartCodeQualityGatePayload(): ThreadTurnStartCodeQualityGate | undefined {
  const s = useCodeQualityGateStore.getState();
  if (s.turnStartGateMode === "off") {
    return undefined;
  }
  if (s.minScorePerSnippet !== 70) {
    return { mode: s.turnStartGateMode, minScorePerSnippet: s.minScorePerSnippet };
  }
  return { mode: s.turnStartGateMode };
}
