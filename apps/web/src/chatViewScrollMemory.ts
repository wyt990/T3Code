/**
 * Phase 3.6 — Per-tab LegendList scroll position memory.
 *
 * Each ChatView's LegendList instance is unmounted whenever the user switches
 * to a different tab (and the prior tab is no longer rendered). To preserve
 * the user's reading position across those mount/unmount cycles, we cache the
 * last known scroll offset against a stable per-thread key.
 *
 * - In-memory only by design: scroll positions don't survive a full page
 *   reload, so we don't need (and don't want) localStorage persistence here.
 * - Keyed by `${routeKind}:${scopedThreadKey}` so a draft tab promoted to a
 *   server tab does not accidentally inherit the draft's scroll position.
 * - Saving with a non-positive or non-finite offset clears the entry instead
 *   of polluting the cache (which keeps the "freshly opened, scroll-to-end"
 *   default working).
 */

const memory = new Map<string, number>();

export interface ChatViewScrollKey {
  readonly routeKind: "server" | "draft";
  readonly scopedThreadKey: string;
}

function buildKey({ routeKind, scopedThreadKey }: ChatViewScrollKey): string {
  return `${routeKind}:${scopedThreadKey}`;
}

export function rememberChatViewScrollOffset(key: ChatViewScrollKey, offset: number): void {
  if (!Number.isFinite(offset) || offset <= 0) {
    memory.delete(buildKey(key));
    return;
  }
  memory.set(buildKey(key), offset);
}

export function recallChatViewScrollOffset(key: ChatViewScrollKey): number | undefined {
  return memory.get(buildKey(key));
}

export function forgetChatViewScrollOffset(key: ChatViewScrollKey): void {
  memory.delete(buildKey(key));
}

/**
 * Test helper. Clears the in-memory map between tests so flakiness from
 * prior runs cannot leak in.
 */
export function __resetChatViewScrollMemoryForTesting(): void {
  memory.clear();
}
