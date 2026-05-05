import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { DraftId } from "../../draftId";
import { isClosedTabTargetSuppressed, suppressClosedTabTargets } from "./tabCloseSuppression";

const ENV = EnvironmentId.make("env-1");

describe("tabCloseSuppression", () => {
  it("suppresses recently closed targets", () => {
    const now = 1000;
    const target = {
      kind: "server" as const,
      threadRef: { environmentId: ENV, threadId: ThreadId.make("t-1") },
    };
    suppressClosedTabTargets([target], now);
    expect(isClosedTabTargetSuppressed(target, now + 500)).toBe(true);
  });

  it("expires suppression after TTL", () => {
    const now = 2000;
    const target = { kind: "draft" as const, draftId: DraftId.make("d-1") };
    suppressClosedTabTargets([target], now);
    expect(isClosedTabTargetSuppressed(target, now + 1600)).toBe(false);
  });
});
