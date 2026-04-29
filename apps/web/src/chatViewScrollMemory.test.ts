import { afterEach, describe, expect, it } from "vitest";

import {
  __resetChatViewScrollMemoryForTesting,
  forgetChatViewScrollOffset,
  recallChatViewScrollOffset,
  rememberChatViewScrollOffset,
  type ChatViewScrollKey,
} from "./chatViewScrollMemory";

const serverKey: ChatViewScrollKey = {
  routeKind: "server",
  scopedThreadKey: "env-1::thread-1",
};
const draftKey: ChatViewScrollKey = {
  routeKind: "draft",
  scopedThreadKey: "env-1::thread-1",
};

afterEach(() => {
  __resetChatViewScrollMemoryForTesting();
});

describe("chatViewScrollMemory", () => {
  it("recalls a stored offset", () => {
    rememberChatViewScrollOffset(serverKey, 1234);
    expect(recallChatViewScrollOffset(serverKey)).toBe(1234);
  });

  it("returns undefined for unknown keys", () => {
    expect(recallChatViewScrollOffset(serverKey)).toBeUndefined();
  });

  it("clears the entry when storing zero or a negative value", () => {
    rememberChatViewScrollOffset(serverKey, 200);
    rememberChatViewScrollOffset(serverKey, 0);
    expect(recallChatViewScrollOffset(serverKey)).toBeUndefined();

    rememberChatViewScrollOffset(serverKey, 200);
    rememberChatViewScrollOffset(serverKey, -50);
    expect(recallChatViewScrollOffset(serverKey)).toBeUndefined();
  });

  it("ignores non-finite offsets without polluting the cache", () => {
    rememberChatViewScrollOffset(serverKey, 200);
    rememberChatViewScrollOffset(serverKey, Number.POSITIVE_INFINITY);
    expect(recallChatViewScrollOffset(serverKey)).toBeUndefined();

    rememberChatViewScrollOffset(serverKey, 200);
    rememberChatViewScrollOffset(serverKey, Number.NaN);
    expect(recallChatViewScrollOffset(serverKey)).toBeUndefined();
  });

  it("isolates server tabs from draft tabs that happen to share a thread key", () => {
    rememberChatViewScrollOffset(serverKey, 100);
    rememberChatViewScrollOffset(draftKey, 200);
    expect(recallChatViewScrollOffset(serverKey)).toBe(100);
    expect(recallChatViewScrollOffset(draftKey)).toBe(200);
  });

  it("forgetChatViewScrollOffset removes a stored entry", () => {
    rememberChatViewScrollOffset(serverKey, 999);
    forgetChatViewScrollOffset(serverKey);
    expect(recallChatViewScrollOffset(serverKey)).toBeUndefined();
  });
});
