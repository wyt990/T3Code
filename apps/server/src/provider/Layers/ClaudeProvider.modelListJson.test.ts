import { describe, expect, it } from "vitest";
import { Result } from "effect";

import { decodeJsonResult } from "@t3tools/shared/schemaJson";

import { ClaudeCliModelListJsonSchema } from "./ClaudeProvider.ts";

const decode = decodeJsonResult(ClaudeCliModelListJsonSchema);

describe("ClaudeCliModelListJsonSchema", () => {
  it("accepts settings as empty object (current CLI output)", () => {
    const raw = JSON.stringify({
      provider: "firstParty",
      currentModel: "m1",
      defaultModel: "m2",
      builtinModels: [],
      customModels: [],
      settings: {},
    });
    const out = decode(raw);
    expect(Result.isSuccess(out)).toBe(true);
    if (Result.isSuccess(out)) {
      expect(out.success.settings).toEqual({});
    }
  });

  it("accepts settings.model when present", () => {
    const raw = JSON.stringify({
      provider: "firstParty",
      currentModel: "m1",
      defaultModel: "m2",
      builtinModels: [],
      customModels: [],
      settings: { model: "m1" },
    });
    expect(Result.isSuccess(decode(raw))).toBe(true);
  });
});
