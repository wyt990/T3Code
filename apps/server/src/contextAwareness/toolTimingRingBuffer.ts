import type { ContextToolTimingEntry, ThreadId } from "@t3tools/contracts";

const MAX = 2000;
const ring: ContextToolTimingEntry[] = [];

/**
 * 进程内环形缓冲：在 Provider 工具生命周期投影路径上追加，供 `context.getToolTimingPool` 读取。
 */
export function appendToolTimingSample(entry: ContextToolTimingEntry): void {
  ring.push(entry);
  if (ring.length > MAX) {
    ring.splice(0, ring.length - MAX);
  }
}

export function snapshotToolTimingPool(limit: number | undefined): {
  entries: ContextToolTimingEntry[];
} {
  const n = Math.min(Math.max(limit ?? 200, 1), MAX);
  return { entries: ring.slice(-n) };
}

export function appendToolTimingFromProviderToolEvent(input: {
  readonly createdAtIso: string;
  readonly phase: ContextToolTimingEntry["phase"];
  readonly summary: string;
  readonly threadId?: ThreadId | undefined;
}): void {
  const atMs = Date.parse(input.createdAtIso);
  if (!Number.isFinite(atMs)) {
    return;
  }
  appendToolTimingSample({
    atMs,
    phase: input.phase,
    summary: input.summary,
    ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
  });
}
