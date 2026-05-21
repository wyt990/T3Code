import type { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { Result, Schema } from "effect";
import { createModelCapabilities } from "@t3tools/shared/model";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";

import { compareCliVersions } from "./cliVersion.ts";
import { buildBooleanOptionDescriptor, buildSelectOptionDescriptor } from "./providerSnapshot.ts";

const ClaudeOpenaiCompatProviderModel = Schema.Struct({
  originalName: Schema.String,
  routedValue: Schema.String,
});

const ClaudeOpenaiCompatProvider = Schema.Struct({
  id: Schema.String,
  baseUrl: Schema.String,
  models: Schema.Array(ClaudeOpenaiCompatProviderModel),
});

const ClaudeOpenaiCompat = Schema.Struct({
  enabled: Schema.Boolean,
  providers: Schema.Array(ClaudeOpenaiCompatProvider),
});

const ClaudeZenFreeModel = Schema.Struct({
  originalName: Schema.String,
  routedValue: Schema.String,
});

const ClaudeZenFreeModels = Schema.Struct({
  enabled: Schema.Boolean,
  models: Schema.Array(ClaudeZenFreeModel),
});

const ClaudeCustomModel = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
});

const ClaudeBuiltinModel = Schema.Struct({
  id: Schema.String,
});

/** Matches `claudecode --list-models --json` shape (local and remote). */
export const ClaudeCliModelListJsonSchema = Schema.Struct({
  provider: Schema.String,
  currentModel: Schema.String,
  defaultModel: Schema.String,
  builtinModels: Schema.Array(ClaudeBuiltinModel),
  customModels: Schema.Array(ClaudeCustomModel),
  openaiCompat: Schema.optional(ClaudeOpenaiCompat),
  zenFreeModels: Schema.optional(ClaudeZenFreeModels),
  settings: Schema.optional(
    Schema.Struct({
      model: Schema.optional(Schema.String),
    }),
  ),
});

export type ClaudeModelListJson = typeof ClaudeCliModelListJsonSchema.Type;

export const DEFAULT_CLAUDE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export const MINIMUM_CLAUDE_OPUS_4_7_VERSION = "2.1.111";

export const BUILT_IN_CLAUDE_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
            { value: "xhigh", label: "Extra High", isDefault: true },
            { value: "max", label: "Max" },
            { value: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        }),
        buildSelectOptionDescriptor({
          id: "contextWindow",
          label: "Context Window",
          options: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        }),
      ],
    }),
  },
  {
    slug: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High", isDefault: true },
            { value: "max", label: "Max" },
            { value: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        }),
        buildBooleanOptionDescriptor({
          id: "fastMode",
          label: "Fast Mode",
        }),
        buildSelectOptionDescriptor({
          id: "contextWindow",
          label: "Context Window",
          options: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        }),
      ],
    }),
  },
  {
    slug: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High", isDefault: true },
            { value: "max", label: "Max" },
          ],
        }),
        buildBooleanOptionDescriptor({
          id: "fastMode",
          label: "Fast Mode",
        }),
      ],
    }),
  },
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High", isDefault: true },
            { value: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        }),
        buildSelectOptionDescriptor({
          id: "contextWindow",
          label: "Context Window",
          options: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        }),
      ],
    }),
  },
  {
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildBooleanOptionDescriptor({
          id: "thinking",
          label: "Thinking",
        }),
      ],
    }),
  },
];

export function supportsClaudeOpus47(version: string | null | undefined): boolean {
  return version ? compareCliVersions(version, MINIMUM_CLAUDE_OPUS_4_7_VERSION) >= 0 : false;
}

export function getBuiltInClaudeModelsForVersion(
  version: string | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (supportsClaudeOpus47(version)) {
    return BUILT_IN_CLAUDE_MODELS;
  }
  return BUILT_IN_CLAUDE_MODELS.filter((model) => model.slug !== "claude-opus-4-7");
}

export function formatClaudeOpus47UpgradeMessage(version: string | null): string {
  const versionLabel = version ? `v${version}` : "the installed version";
  return `Claude Code ${versionLabel} is too old for Claude Opus 4.7. Upgrade to v${MINIMUM_CLAUDE_OPUS_4_7_VERSION} or newer to access it.`;
}

export function parseClaudeModelListFromJson(
  json: ClaudeModelListJson,
): ReadonlyArray<ServerProviderModel> {
  const models: Array<ServerProviderModel> = [];
  const seen = new Set<string>();

  const addModel = (slug: string, name: string, subProvider?: string) => {
    const normalized = slug.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    models.push({
      slug: normalized,
      name: name.trim() || normalized,
      ...(subProvider ? { subProvider } : {}),
      isCustom: false,
      capabilities: DEFAULT_CLAUDE_MODEL_CAPABILITIES,
    });
  };

  for (const model of json.customModels) {
    addModel(model.id, model.id);
  }

  if (json.openaiCompat?.enabled) {
    for (const provider of json.openaiCompat.providers) {
      for (const model of provider.models) {
        addModel(model.routedValue, model.originalName, provider.id);
      }
    }
  }

  if (json.zenFreeModels?.enabled) {
    for (const model of json.zenFreeModels.models) {
      addModel(model.routedValue, model.originalName, "zen");
    }
  }

  return models;
}

export function resolveClaudeModelsFromCliJson(
  json: ClaudeModelListJson,
  version: string | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  const parsed = parseClaudeModelListFromJson(json);
  if (parsed.length > 0) {
    return parsed;
  }
  return getBuiltInClaudeModelsForVersion(version);
}

export function resolveClaudeModelsFromCliStdout(
  stdout: string,
  version: string | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return getBuiltInClaudeModelsForVersion(version);
  }
  const decoded = decodeJsonResult(ClaudeCliModelListJsonSchema)(trimmed);
  if (Result.isFailure(decoded)) {
    return [];
  }
  return resolveClaudeModelsFromCliJson(decoded.success, version);
}
