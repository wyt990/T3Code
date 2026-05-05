import type { TabTarget } from "../../uiTabsState";
import { tabTargetKey } from "./TabBar.logic";

const CLOSED_TARGET_SUPPRESS_TTL_MS = 1500;
const suppressedClosedTargetExpiresAtByKey = new Map<string, number>();

function pruneSuppressedClosedTargets(now: number): void {
  for (const [key, expiresAt] of suppressedClosedTargetExpiresAtByKey.entries()) {
    if (expiresAt <= now) {
      suppressedClosedTargetExpiresAtByKey.delete(key);
    }
  }
}

export function suppressClosedTabTargets(
  targets: readonly TabTarget[],
  now: number = Date.now(),
): void {
  pruneSuppressedClosedTargets(now);
  const expiresAt = now + CLOSED_TARGET_SUPPRESS_TTL_MS;
  for (const target of targets) {
    suppressedClosedTargetExpiresAtByKey.set(tabTargetKey(target), expiresAt);
  }
}

export function isClosedTabTargetSuppressed(target: TabTarget, now: number = Date.now()): boolean {
  pruneSuppressedClosedTargets(now);
  const expiresAt = suppressedClosedTargetExpiresAtByKey.get(tabTargetKey(target));
  return typeof expiresAt === "number" && expiresAt > now;
}
