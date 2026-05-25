import { assert, it } from "@effect/vitest";

import { resolveSshClaudeAgentModels, resolveSshOpenCodeModels } from "./connectionProviders.ts";

it("resolveSshClaudeAgentModels uses cached remote models when present", () => {
  const models = resolveSshClaudeAgentModels({
    cachedRemoteModels: [
      {
        slug: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        capabilities: { optionDescriptors: [] },
        isCustom: false,
      },
    ],
    customModels: [],
    claudeVersion: "1.0.0",
  });

  assert.equal(
    models.some((model) => model.slug === "deepseek-v4-flash"),
    true,
  );
});

it("resolveSshClaudeAgentModels falls back to built-in models when remote cache is empty", () => {
  const models = resolveSshClaudeAgentModels({
    cachedRemoteModels: [],
    customModels: [],
    claudeVersion: null,
  });

  assert.isTrue(models.length > 0);
});

it("resolveSshClaudeAgentModels merges custom models with remote cache", () => {
  const models = resolveSshClaudeAgentModels({
    cachedRemoteModels: [
      {
        slug: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        capabilities: { optionDescriptors: [] },
        isCustom: false,
      },
    ],
    customModels: ["my-custom-model"],
    claudeVersion: null,
  });

  assert.isTrue(models.some((model) => model.slug === "my-custom-model"));
});

it("resolveSshOpenCodeModels returns probed models when present", () => {
  const models = resolveSshOpenCodeModels({
    probedModels: [
      { slug: "gpt-4", name: "GPT-4", capabilities: { optionDescriptors: [] }, isCustom: false },
    ],
    customModels: [],
  });
  assert.equal(models[0]?.slug, "gpt-4");
});

it("resolveSshClaudeAgentModels still returns built-in models when probe is unavailable", () => {
  const models = resolveSshClaudeAgentModels({
    cachedRemoteModels: [],
    customModels: [],
    claudeVersion: null,
  });
  assert.isTrue(models.length > 0);
});
