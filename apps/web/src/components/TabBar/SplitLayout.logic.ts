import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO } from "../../uiTabsState";

export interface PointerToSplitRatioInput {
  /** Pointer client X coordinate (CSS px). */
  pointerX: number;
  /** `getBoundingClientRect().left` of the split container. */
  containerLeft: number;
  /** `getBoundingClientRect().width` of the split container. */
  containerWidth: number;
  /** Minimum ratio for the left pane (defaults to {@link MIN_SPLIT_RATIO}). */
  minRatio?: number;
  /** Maximum ratio for the left pane (defaults to {@link MAX_SPLIT_RATIO}). */
  maxRatio?: number;
}

/**
 * Convert a pointer X coordinate to a clamped split ratio (left pane width as a
 * fraction of the container). Returns `null` for inputs that cannot yield a
 * sensible ratio (zero/negative width, non-finite numbers); callers are
 * expected to ignore null and skip the resize.
 */
export function pointerXToSplitRatio(input: PointerToSplitRatioInput): number | null {
  const {
    pointerX,
    containerLeft,
    containerWidth,
    minRatio = MIN_SPLIT_RATIO,
    maxRatio = MAX_SPLIT_RATIO,
  } = input;
  if (!Number.isFinite(pointerX) || !Number.isFinite(containerLeft)) return null;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return null;
  if (!Number.isFinite(minRatio) || !Number.isFinite(maxRatio)) return null;
  if (minRatio >= maxRatio) return null;
  const raw = (pointerX - containerLeft) / containerWidth;
  return clamp(raw, minRatio, maxRatio);
}

/**
 * Convenience helper: snap ratios that are within `epsilon` of the canonical
 * 50/50 split to exactly 0.5 so a careful drag near the centre lands cleanly.
 * Uses no DOM access; safe for unit tests.
 */
export function snapToHalfRatio(ratio: number, epsilon = 0.01): number {
  if (!Number.isFinite(ratio)) return ratio;
  if (Math.abs(ratio - 0.5) < epsilon) return 0.5;
  return ratio;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
