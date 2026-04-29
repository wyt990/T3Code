import type {
  ClaudeSettings,
  ClaudeModelSelection,
  ModelCapabilities,
  ServerProvider,
  ServerProviderModel,
  ServerProviderAuth,
  ServerProviderSlashCommand,
  ServerProviderState,
} from "@t3tools/contracts";
import { Cache, Duration, Effect, Equal, Layer, Option, Result, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import * as os from "node:os";
import * as path from "node:path";

// ── CLI model list JSON schema ───────────────────────────────────────────

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

const ClaudeModelListJson = Schema.Struct({
  provider: Schema.String,
  currentModel: Schema.String,
  defaultModel: Schema.String,
  builtinModels: Schema.Array(ClaudeBuiltinModel),
  customModels: Schema.Array(ClaudeCustomModel),
  openaiCompat: Schema.optional(ClaudeOpenaiCompat),
  zenFreeModels: Schema.optional(ClaudeZenFreeModels),
  settings: Schema.optional(Schema.Struct({
    model: Schema.String,
  })),
});
type ClaudeModelListJson = typeof ClaudeModelListJson.Type;

import {
  createModelCapabilities,
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import {
  query as claudeQuery,
  type SlashCommand as ClaudeSlashCommand,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import {
  buildBooleanOptionDescriptor,
  buildSelectOptionDescriptor,
  buildServerProvider,
  AUTH_PROBE_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  extractAuthBoolean,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from "../providerSnapshot.ts";
import { compareCliVersions } from "../cliVersion.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { ClaudeProvider } from "../Services/ClaudeProvider.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ServerSettingsError } from "@t3tools/contracts";

// ── Windows binary path resolution ───────────────────────────────────────

const fs = require("node:fs");

/**
 * Parse a Windows .cmd wrapper script to extract the actual .exe path.
 *
 * The .cmd wrapper typically contains:
 *   @echo off
 *   set "CLAUDE_CODE_INSTALL_PREFIX=C:\Users\...\claude-code-local"
 *   "C:\Users\...\claude-code-local\claudecode.exe" %*
 */
function parseCmdWrapperForExePath(cmdPath: string): string | null {
  try {
    const content = fs.readFileSync(cmdPath, "utf-8");
    // Look for a quoted path ending with .exe
    const match = content.match(/"([^"]+\.exe)"/i);
    if (match?.[1]) {
      const exePath = match[1];
      if (fs.existsSync(exePath)) {
        return exePath;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Parse a .env file and return key-value pairs.
 */
function parseEnvFile(envPath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Get the Claude Code install prefix directory.
 * This is where the .env file with API keys is stored.
 */
function getClaudeCodeInstallPrefix(): string | null {
  // From environment variable
  if (process.env.CLAUDE_CODE_INSTALL_PREFIX) {
    // console.log("[ClaudeProvider] Install prefix from env:", process.env.CLAUDE_CODE_INSTALL_PREFIX);
    return process.env.CLAUDE_CODE_INSTALL_PREFIX;
  }
  // Default location on Windows
  if (process.platform === "win32") {
    // Try LOCALAPPDATA first, then USERPROFILE as fallback
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const prefix = path.join(localAppData, "claude-code-local");
      // console.log("[ClaudeProvider] Install prefix from LOCALAPPDATA:", prefix);
      return prefix;
    }
    // Fallback to USERPROFILE\AppData\Local
    const userProfile = process.env.USERPROFILE || os.homedir();
    if (userProfile) {
      const prefix = path.join(userProfile, "AppData", "Local", "claude-code-local");
      // console.log("[ClaudeProvider] Install prefix from USERPROFILE fallback:", prefix);
      return prefix;
    }
  }
  // Default location on macOS/Linux
  if (process.platform === "darwin" && process.env.HOME) {
    return path.join(process.env.HOME, ".claude-code-local");
  }
  // console.log("[ClaudeProvider] Could not determine install prefix");
  return null;
}

/**
 * Load environment variables from Claude Code's .env file.
 * These contain API keys and provider configurations needed for
 * OpenAI-compatible providers.
 */
export function loadClaudeCodeEnv(): Record<string, string> {
  const installPrefix = getClaudeCodeInstallPrefix();
  if (!installPrefix) {
    console.log("[ClaudeProvider] No install prefix found");
    return {};
  }
  const envPath = path.join(installPrefix, ".env");
  // console.log("[ClaudeProvider] Looking for .env at:", envPath);
  if (!fs.existsSync(envPath)) {
    console.log("[ClaudeProvider] .env file does not exist");
    return {};
  }
  const env = parseEnvFile(envPath);
  // console.log("[ClaudeProvider] Loaded", Object.keys(env).length, "env vars from .env");
  return env;
}

/**
 * On Windows, `claudecode` may be installed as a `.cmd` wrapper script.
 * The SDK's spawn() doesn't resolve `.cmd` files automatically, so we
 * detect and resolve to the actual `.exe` path.
 */
export function resolveClaudeBinaryPath(binaryPath: string): string {
  // Only need special handling on Windows
  if (process.platform !== "win32") {
    return binaryPath;
  }

  // If already an absolute path to .exe, use as-is
  if (path.isAbsolute(binaryPath) && binaryPath.toLowerCase().endsWith(".exe")) {
    return binaryPath;
  }

  // Strategy 1: Check %LOCALAPPDATA%\claude-code-local\claudecode.exe
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const nativeExePath = path.join(localAppData, "claude-code-local", "claudecode.exe");
    if (fs.existsSync(nativeExePath)) {
      return nativeExePath;
    }
  }

  // Strategy 2: Find .cmd in PATH and parse it for .exe path
  // Common locations: %USERPROFILE%\.local\bin, %APPDATA%\npm
  const cmdName = binaryPath.endsWith(".cmd") ? binaryPath : `${binaryPath}.cmd`;
  const searchPaths = [
    path.join(os.homedir(), ".local", "bin"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
    process.env.PATH?.split(path.delimiter) ?? [],
  ].flat().filter((p): p is string => p !== null);

  for (const searchPath of searchPaths) {
    const cmdPath = path.join(searchPath, cmdName);
    if (fs.existsSync(cmdPath)) {
      const exePath = parseCmdWrapperForExePath(cmdPath);
      if (exePath) {
        return exePath;
      }
    }
  }

  // Return original path as fallback
  return binaryPath;
}

const DEFAULT_CLAUDE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const PROVIDER = "claudeAgent" as const;
const CLAUDE_PRESENTATION = {
  displayName: "Claude",
  showInteractionModeToggle: true,
} as const;
const MINIMUM_CLAUDE_OPUS_4_7_VERSION = "2.1.111";
const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
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

function supportsClaudeOpus47(version: string | null | undefined): boolean {
  return version ? compareCliVersions(version, MINIMUM_CLAUDE_OPUS_4_7_VERSION) >= 0 : false;
}

function getBuiltInClaudeModelsForVersion(
  version: string | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (supportsClaudeOpus47(version)) {
    return BUILT_IN_MODELS;
  }
  return BUILT_IN_MODELS.filter((model) => model.slug !== "claude-opus-4-7");
}

function formatClaudeOpus47UpgradeMessage(version: string | null): string {
  const versionLabel = version ? `v${version}` : "the installed version";
  return `Claude Code ${versionLabel} is too old for Claude Opus 4.7. Upgrade to v${MINIMUM_CLAUDE_OPUS_4_7_VERSION} or newer to access it.`;
}

// ── Dynamic model discovery from CLI ────────────────────────────────────

const MODEL_LIST_TIMEOUT_MS = 10_000;

/**
 * Parse model list JSON from `claudecode --list-models --json` and convert
 * to ServerProviderModel array. Uses default capabilities for all models
 * since CLI output doesn't include capability metadata.
 */
function parseClaudeModelList(json: ClaudeModelListJson): ReadonlyArray<ServerProviderModel> {
  const models: Array<ServerProviderModel> = [];
  const seen = new Set<string>();

  // Helper to add model with deduplication
  const addModel = (slug: string, name: string, subProvider?: string) => {
    const normalized = slug.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    models.push({
      slug: normalized,
      name: name.trim() || normalized,
      ...(subProvider ? { subProvider } : {}),
      isCustom: false,
      capabilities: DEFAULT_CLAUDE_MODEL_CAPABILITIES,
    });
  };

  // Custom models from environment variables
  for (const model of json.customModels) {
    addModel(model.id, model.id);
  }

  // OpenAI compatible providers
  if (json.openaiCompat?.enabled) {
    for (const provider of json.openaiCompat.providers) {
      for (const model of provider.models) {
        addModel(model.routedValue, model.originalName, provider.id);
      }
    }
  }

  // Zen free models
  if (json.zenFreeModels?.enabled) {
    for (const model of json.zenFreeModels.models) {
      addModel(model.routedValue, model.originalName, "zen");
    }
  }

  return models;
}

/**
 * Fetch model list from Claude CLI. Returns empty array on failure,
 * allowing fallback to built-in models.
 */
const fetchClaudeModelsList = Effect.fn("fetchClaudeModelsList")(function* (binaryPath: string) {
  const command = ChildProcess.make(binaryPath, ["--list-models", "--json"], {
    shell: process.platform === "win32",
  });

  const result = yield* spawnAndCollect(binaryPath, command).pipe(
    Effect.timeoutOption(MODEL_LIST_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(result)) {
    return [] as ReadonlyArray<ServerProviderModel>;
  }

  if (Option.isNone(result.success)) {
    return [] as ReadonlyArray<ServerProviderModel>;
  }

  const { stdout } = result.success.value;
  if (!stdout || !stdout.trim()) {
    return [] as ReadonlyArray<ServerProviderModel>;
  }

  // Try to parse JSON output
  const parsed = decodeJsonResult(ClaudeModelListJson)(stdout.trim());
  if (Result.isFailure(parsed)) {
    return [] as ReadonlyArray<ServerProviderModel>;
  }

  return parseClaudeModelList(parsed.success);
});

export function getClaudeModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim();
  return (
    BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ??
    DEFAULT_CLAUDE_MODEL_CAPABILITIES
  );
}

export function resolveClaudeEffort(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const descriptors = getProviderOptionDescriptors({
    caps,
    ...(raw ? { selections: [{ id: "effort", value: raw }] } : {}),
  });
  const effortDescriptor = descriptors.find((descriptor) => descriptor.id === "effort");
  const value = getProviderOptionCurrentValue(effortDescriptor);
  return typeof value === "string" ? value : undefined;
}

/**
 * Normalize a resolved Claude effort value into one suitable for the Claude
 * CLI's `--effort` flag.
 *
 * Mirrors the mapping used when invoking the Claude Agent SDK
 * ({@link getEffectiveClaudeAgentEffort} in ClaudeAdapter): the Opus 4.7
 * capability `"xhigh"` is rewritten to the accepted CLI value `"max"`, and
 * `"ultrathink"` is filtered out because it is a prompt-prefix mode rather
 * than a CLI-effort value. Returns `undefined` when no flag should be passed.
 */
export function normalizeClaudeCliEffort(effort: string | null | undefined): string | undefined {
  if (!effort || effort === "ultrathink") {
    return undefined;
  }
  if (effort === "xhigh") {
    return "max";
  }
  return effort;
}

export function resolveClaudeApiModelId(modelSelection: ClaudeModelSelection): string {
  switch (getModelSelectionStringOptionValue(modelSelection, "contextWindow")) {
    case "1m":
      return `${modelSelection.model}[1m]`;
    default:
      return modelSelection.model;
  }
}
export function parseClaudeAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message:
        "Claude Agent authentication status command is unavailable in this version of Claude.",
    };
  }

  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("run `claude login`") ||
    lowerOutput.includes("run claude login")
  ) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Claude is not authenticated. Run `claude auth login` and try again.",
    };
  }

  const parsedAuth = (() => {
    const trimmed = result.stdout.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
    try {
      return {
        attemptedJsonParse: true as const,
        auth: extractAuthBoolean(JSON.parse(trimmed)),
      };
    } catch {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
  })();

  if (parsedAuth.auth === true) {
    return { status: "ready", auth: { status: "authenticated" } };
  }
  if (parsedAuth.auth === false) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Claude is not authenticated. Run `claude auth login` and try again.",
    };
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message:
        "Could not verify Claude authentication status from JSON output (missing auth marker).",
    };
  }
  if (result.code === 0) {
    return { status: "ready", auth: { status: "authenticated" } };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    auth: { status: "unknown" },
    message: detail
      ? `Could not verify Claude authentication status. ${detail}`
      : "Could not verify Claude authentication status.",
  };
}

// ── Subscription type detection ─────────────────────────────────────
//
// The SDK probe returns typed `AccountInfo.subscriptionType` directly.
// This walker is a best-effort fallback for the `claude auth status`
// JSON output whose shape is not guaranteed.

/** Keys that directly hold a subscription/plan identifier. */
const SUBSCRIPTION_TYPE_KEYS = [
  "subscriptionType",
  "subscription_type",
  "plan",
  "tier",
  "planType",
  "plan_type",
] as const;

/** Keys whose value may be a nested object containing subscription info. */
const SUBSCRIPTION_CONTAINER_KEYS = ["account", "subscription", "user", "billing"] as const;
const AUTH_METHOD_KEYS = ["authMethod", "auth_method"] as const;
const AUTH_METHOD_CONTAINER_KEYS = ["auth", "account", "session"] as const;

/** Lift an unknown value into `Option<string>` if it is a non-empty string. */
const asNonEmptyString = (v: unknown): Option.Option<string> =>
  typeof v === "string" && v.length > 0 ? Option.some(v) : Option.none();

/** Lift an unknown value into `Option<Record>` if it is a plain object. */
const asRecord = (v: unknown): Option.Option<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !globalThis.Array.isArray(v)
    ? Option.some(v as Record<string, unknown>)
    : Option.none();

/**
 * Walk an unknown parsed JSON value looking for a subscription/plan
 * identifier, returning the first match as an `Option`.
 */
function findSubscriptionType(value: unknown): Option.Option<string> {
  if (globalThis.Array.isArray(value)) {
    return Option.firstSomeOf(value.map(findSubscriptionType));
  }

  return asRecord(value).pipe(
    Option.flatMap((record) => {
      const direct = Option.firstSomeOf(
        SUBSCRIPTION_TYPE_KEYS.map((key) => asNonEmptyString(record[key])),
      );
      if (Option.isSome(direct)) return direct;

      return Option.firstSomeOf(
        SUBSCRIPTION_CONTAINER_KEYS.map((key) =>
          asRecord(record[key]).pipe(Option.flatMap(findSubscriptionType)),
        ),
      );
    }),
  );
}

function findAuthMethod(value: unknown): Option.Option<string> {
  if (globalThis.Array.isArray(value)) {
    return Option.firstSomeOf(value.map(findAuthMethod));
  }

  return asRecord(value).pipe(
    Option.flatMap((record) => {
      const direct = Option.firstSomeOf(
        AUTH_METHOD_KEYS.map((key) => asNonEmptyString(record[key])),
      );
      if (Option.isSome(direct)) return direct;

      return Option.firstSomeOf(
        AUTH_METHOD_CONTAINER_KEYS.map((key) =>
          asRecord(record[key]).pipe(Option.flatMap(findAuthMethod)),
        ),
      );
    }),
  );
}

/**
 * Try to extract a subscription type from the `claude auth status` JSON
 * output. This is a zero-cost operation on data we already have.
 */
const decodeUnknownJson = decodeJsonResult(Schema.Unknown);

function extractSubscriptionTypeFromOutput(result: CommandResult): string | undefined {
  const parsed = decodeUnknownJson(result.stdout.trim());
  if (Result.isFailure(parsed)) return undefined;
  return Option.getOrUndefined(findSubscriptionType(parsed.success));
}

function extractClaudeAuthMethodFromOutput(result: CommandResult): string | undefined {
  const parsed = decodeUnknownJson(result.stdout.trim());
  if (Result.isFailure(parsed)) return undefined;
  return Option.getOrUndefined(findAuthMethod(parsed.success));
}

function toTitleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function claudeSubscriptionLabel(subscriptionType: string | undefined): string | undefined {
  const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;

  switch (normalized) {
    case "max":
    case "maxplan":
    case "max5":
    case "max20":
      return "Max";
    case "enterprise":
      return "Enterprise";
    case "team":
      return "Team";
    case "pro":
      return "Pro";
    case "free":
      return "Free";
    default:
      return toTitleCaseWords(subscriptionType!);
  }
}

function normalizeClaudeAuthMethod(authMethod: string | undefined): string | undefined {
  const normalized = authMethod?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;
  if (normalized === "apikey") return "apiKey";
  return undefined;
}

function claudeAuthMetadata(input: {
  readonly subscriptionType: string | undefined;
  readonly authMethod: string | undefined;
}): { readonly type: string; readonly label: string } | undefined {
  if (normalizeClaudeAuthMethod(input.authMethod) === "apiKey") {
    return {
      type: "apiKey",
      label: "Claude API Key",
    };
  }

  if (input.subscriptionType) {
    const subscriptionLabel = claudeSubscriptionLabel(input.subscriptionType);
    return {
      type: input.subscriptionType,
      label: `Claude ${subscriptionLabel ?? toTitleCaseWords(input.subscriptionType)} Subscription`,
    };
  }

  return undefined;
}

// ── SDK capability probe ────────────────────────────────────────────

const CAPABILITIES_PROBE_TIMEOUT_MS = 8_000;

function nonEmptyProbeString(value: string): string | undefined {
  const candidate = value.trim();
  return candidate ? candidate : undefined;
}

function parseClaudeInitializationCommands(
  commands: ReadonlyArray<ClaudeSlashCommand> | undefined,
): ReadonlyArray<ServerProviderSlashCommand> {
  return dedupeSlashCommands(
    (commands ?? []).flatMap((command) => {
      const name = nonEmptyProbeString(command.name);
      if (!name) {
        return [];
      }

      const description = nonEmptyProbeString(command.description);
      const argumentHint = nonEmptyProbeString(command.argumentHint);

      return [
        {
          name,
          ...(description ? { description } : {}),
          ...(argumentHint ? { input: { hint: argumentHint } } : {}),
        } satisfies ServerProviderSlashCommand,
      ];
    }),
  );
}

function dedupeSlashCommands(
  commands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const commandsByName = new Map<string, ServerProviderSlashCommand>();

  for (const command of commands) {
    const name = nonEmptyProbeString(command.name);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const existing = commandsByName.get(key);
    if (!existing) {
      commandsByName.set(key, {
        ...command,
        name,
      });
      continue;
    }

    commandsByName.set(key, {
      ...existing,
      ...(existing.description
        ? {}
        : command.description
          ? { description: command.description }
          : {}),
      ...(existing.input?.hint
        ? {}
        : command.input?.hint
          ? { input: { hint: command.input.hint } }
          : {}),
    });
  }

  return [...commandsByName.values()];
}

function waitForAbortSignal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Probe account information by spawning a lightweight Claude Agent SDK
 * session and reading the initialization result.
 *
 * We pass a never-yielding AsyncIterable as the prompt so that no user
 * message is ever written to the subprocess stdin. This means the Claude
 * Code subprocess completes its local initialization IPC (returning
 * account info and slash commands) but never starts an API request to
 * Anthropic. We read the init data and then abort the subprocess.
 *
 * This is used as a fallback when `claude auth status` does not include
 * subscription type information.
 */
const probeClaudeCapabilities = (binaryPath: string) => {
  const abort = new AbortController();
  return Effect.tryPromise(async () => {
    const q = claudeQuery({
      // Never yield — we only need initialization data, not a conversation.
      // This prevents any prompt from reaching the Anthropic API.
      // oxlint-disable-next-line require-yield
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await waitForAbortSignal(abort.signal);
      })(),
      options: {
        persistSession: false,
        pathToClaudeCodeExecutable: binaryPath,
        abortController: abort,
        settingSources: ["user", "project", "local"],
        allowedTools: [],
        stderr: () => {},
      },
    });
    const init = await q.initializationResult();
    return {
      subscriptionType: init.account?.subscriptionType,
      slashCommands: parseClaudeInitializationCommands(init.commands),
    };
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted) abort.abort();
      }),
    ),
    Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS),
    Effect.result,
    Effect.map((result) => {
      if (Result.isFailure(result)) return undefined;
      return Option.isSome(result.success) ? result.success.value : undefined;
    }),
  );
};

const runClaudeCommand = Effect.fn("runClaudeCommand")(function* (args: ReadonlyArray<string>) {
  const claudeSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.claudeAgent),
  );
  const command = ChildProcess.make(claudeSettings.binaryPath, [...args], {
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(claudeSettings.binaryPath, command);
});

export const checkClaudeProviderStatus = Effect.fn("checkClaudeProviderStatus")(function* (
  resolveSubscriptionType?: (binaryPath: string) => Effect.Effect<string | undefined>,
  resolveSlashCommands?: (
    binaryPath: string,
  ) => Effect.Effect<ReadonlyArray<ServerProviderSlashCommand> | undefined>,
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> {
  const claudeSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.claudeAgent),
  );
  const checkedAt = new Date().toISOString();
  const allModels = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    claudeSettings.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );

  if (!claudeSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CLAUDE_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Claude 在设置中已禁用。",
      },
    });
  }

  const versionProbe = yield* runClaudeCommand(["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Claude Agent CLI 未安装或未在 PATH 中。"
          : `执行 Claude Agent CLI 健康检查失败: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Claude Agent CLI 已安装但运行失败。运行命令超时。",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Claude Agent CLI 已安装但运行失败: ${detail}`
          : "Claude Agent CLI 已安装但运行失败。",
      },
    });
  }

  // Try to fetch dynamic model list from CLI, fallback to built-in models
  const cliModels = yield* fetchClaudeModelsList(claudeSettings.binaryPath).pipe(
    Effect.orElseSucceed(() => [] as ReadonlyArray<ServerProviderModel>),
  );

  const discoveredModels = cliModels.length > 0
    ? cliModels
    : getBuiltInClaudeModelsForVersion(parsedVersion);

  const models = providerModelsFromSettings(
    discoveredModels,
    PROVIDER,
    claudeSettings.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );
  const opus47UpgradeMessage = supportsClaudeOpus47(parsedVersion)
    ? undefined
    : formatClaudeOpus47UpgradeMessage(parsedVersion);

  const slashCommands =
    (resolveSlashCommands
      ? yield* resolveSlashCommands(claudeSettings.binaryPath).pipe(
          Effect.orElseSucceed(() => undefined),
        )
      : undefined) ?? [];
  const dedupedSlashCommands = dedupeSlashCommands(slashCommands);

  // ── Auth check + subscription detection ────────────────────────────

  const authProbe = yield* runClaudeCommand(["auth", "status"]).pipe(
    Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  // Determine subscription type from multiple sources (cheapest first):
  // 1. `claude auth status` JSON output (may or may not contain it)
  // 2. Cached SDK probe (spawns a Claude process on miss, reads
  //    `initializationResult()` for account metadata, then aborts
  //    immediately — no API tokens are consumed)

  let subscriptionType: string | undefined;
  let authMethod: string | undefined;

  if (Result.isSuccess(authProbe) && Option.isSome(authProbe.success)) {
    subscriptionType = extractSubscriptionTypeFromOutput(authProbe.success.value);
    authMethod = extractClaudeAuthMethodFromOutput(authProbe.success.value);
  }

  if (!subscriptionType && resolveSubscriptionType) {
    subscriptionType = yield* resolveSubscriptionType(claudeSettings.binaryPath);
  }

  // ── Handle auth results (same logic as before, adjusted models) ──

  if (Result.isFailure(authProbe)) {
    const error = authProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models,
      slashCommands: dedupedSlashCommands,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message:
          error instanceof Error
            ? `无法验证 Claude 认证状态: ${error.message}.`
            : "无法验证 Claude 认证状态。",
      },
    });
  }

  if (Option.isNone(authProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models,
      slashCommands: dedupedSlashCommands,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message: "无法验证 Claude 认证状态。运行命令超时。",
      },
    });
  }

  const parsed = parseClaudeAuthStatusFromOutput(authProbe.success.value);
  const authMetadata = claudeAuthMetadata({ subscriptionType, authMethod });
  return buildServerProvider({
    provider: PROVIDER,
    presentation: CLAUDE_PRESENTATION,
    enabled: claudeSettings.enabled,
    checkedAt,
    models,
    slashCommands: dedupedSlashCommands,
    probe: {
      installed: true,
      version: parsedVersion,
      status: parsed.status,
      auth: {
        ...parsed.auth,
        ...(authMetadata ? authMetadata : {}),
      },
      ...(parsed.message
        ? { message: parsed.message }
        : opus47UpgradeMessage
          ? { message: opus47UpgradeMessage }
          : {}),
    },
  });
});

const makePendingClaudeProvider = (claudeSettings: ClaudeSettings): ServerProvider => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    claudeSettings.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );

  if (!claudeSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CLAUDE_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Claude 在设置中已禁用。",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    presentation: CLAUDE_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "本次会话尚未检查 Claude 服务提供商状态。",
    },
  });
};

export const ClaudeProviderLive = Layer.effect(
  ClaudeProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const subscriptionProbeCache = yield* Cache.make({
      capacity: 1,
      timeToLive: Duration.minutes(5),
      lookup: (binaryPath: string) => probeClaudeCapabilities(binaryPath),
    });

    const checkProvider = checkClaudeProviderStatus(
      (binaryPath) =>
        Cache.get(subscriptionProbeCache, binaryPath).pipe(
          Effect.map((probe) => probe?.subscriptionType),
        ),
      (binaryPath) =>
        Cache.get(subscriptionProbeCache, binaryPath).pipe(
          Effect.map((probe) => probe?.slashCommands),
        ),
    ).pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<ClaudeSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.claudeAgent),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.claudeAgent),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: makePendingClaudeProvider,
      checkProvider,
    });
  }),
);
