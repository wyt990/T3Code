import { describe, expect, it } from "vitest";

import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO } from "../../uiTabsState";

import { pointerXToSplitRatio, snapToHalfRatio } from "./SplitLayout.logic";

describe("pointerXToSplitRatio", () => {
  const container = { containerLeft: 100, containerWidth: 400 } as const;

  it("returns 0.5 when the pointer is exactly at the centre", () => {
    expect(pointerXToSplitRatio({ pointerX: 300, ...container })).toBe(0.5);
  });

  it("returns the proportional ratio for off-centre pointers", () => {
    expect(pointerXToSplitRatio({ pointerX: 200, ...container })).toBeCloseTo(0.25, 5);
    expect(pointerXToSplitRatio({ pointerX: 400, ...container })).toBeCloseTo(0.75, 5);
  });

  it("clamps to MIN_SPLIT_RATIO when the pointer is left of the lower bound", () => {
    expect(pointerXToSplitRatio({ pointerX: 100, ...container })).toBe(MIN_SPLIT_RATIO);
    expect(pointerXToSplitRatio({ pointerX: -500, ...container })).toBe(MIN_SPLIT_RATIO);
  });

  it("clamps to MAX_SPLIT_RATIO when the pointer is right of the upper bound", () => {
    expect(pointerXToSplitRatio({ pointerX: 500, ...container })).toBe(MAX_SPLIT_RATIO);
    expect(pointerXToSplitRatio({ pointerX: 5000, ...container })).toBe(MAX_SPLIT_RATIO);
  });

  it("respects custom min/max bounds", () => {
    const ratio = pointerXToSplitRatio({
      pointerX: 200,
      ...container,
      minRatio: 0.3,
      maxRatio: 0.6,
    });
    expect(ratio).toBe(0.3);
  });

  it("returns null for zero/negative container width", () => {
    expect(pointerXToSplitRatio({ pointerX: 100, containerLeft: 0, containerWidth: 0 })).toBeNull();
    expect(
      pointerXToSplitRatio({ pointerX: 100, containerLeft: 0, containerWidth: -10 }),
    ).toBeNull();
  });

  it("returns null for non-finite inputs", () => {
    expect(
      pointerXToSplitRatio({ pointerX: Number.NaN, containerLeft: 0, containerWidth: 100 }),
    ).toBeNull();
    expect(
      pointerXToSplitRatio({
        pointerX: 50,
        containerLeft: Number.POSITIVE_INFINITY,
        containerWidth: 100,
      }),
    ).toBeNull();
  });

  it("returns null when min >= max", () => {
    expect(
      pointerXToSplitRatio({
        pointerX: 200,
        ...container,
        minRatio: 0.7,
        maxRatio: 0.7,
      }),
    ).toBeNull();
  });
});

describe("snapToHalfRatio", () => {
  it("snaps near-centre ratios to exactly 0.5", () => {
    expect(snapToHalfRatio(0.495)).toBe(0.5);
    expect(snapToHalfRatio(0.508)).toBe(0.5);
  });

  it("leaves ratios outside the snap window unchanged", () => {
    expect(snapToHalfRatio(0.4)).toBe(0.4);
    expect(snapToHalfRatio(0.7)).toBe(0.7);
  });

  it("respects a custom epsilon", () => {
    expect(snapToHalfRatio(0.45, 0.01)).toBe(0.45);
    expect(snapToHalfRatio(0.45, 0.06)).toBe(0.5);
  });

  it("passes non-finite values through unchanged", () => {
    expect(snapToHalfRatio(Number.NaN)).toBeNaN();
    expect(snapToHalfRatio(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});
