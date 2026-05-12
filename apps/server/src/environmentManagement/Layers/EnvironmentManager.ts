import { Effect, Layer, Ref } from "effect";
import * as FS from "node:fs/promises";
import * as Path from "node:path";

import {
  EnvironmentManager,
  type EnvironmentManagerShape,
  EnvironmentProfileNotFoundError,
  EnvironmentConfigNotFoundError,
  DependencyAnalysisError,
  EnvironmentExportError,
  EnvironmentImportError,
} from "../Services/EnvironmentManager.ts";
import type {
  EnvironmentTemplate,
  EnvironmentConfig,
  EnvironmentProfile,
  ConfigDiff,
  DependencyTree,
  PackageNode,
  PackageDependency,
  VersionCompatibilityResult,
  DependencyUpdateSuggestion,
  EnvironmentExportRequest,
  EnvironmentExportResult,
  EnvironmentImportRequest,
  EnvironmentImportResult,
  EnvironmentId,
} from "@t3tools/contracts";

// -----------------------------------------------------------------------------
// Default Templates
// -----------------------------------------------------------------------------

const DEFAULT_TEMPLATES: EnvironmentTemplate[] = [
  {
    id: "template-dev",
    name: "开发环境",
    type: "development",
    variables: [
      { key: "NODE_ENV", value: "development", required: true },
      { key: "T3CODE_TRACE_MIN_LEVEL", value: "Debug", required: false },
    ],
    description: "本地开发环境配置",
    isDefault: false,
  },
  {
    id: "template-test",
    name: "测试环境",
    type: "testing",
    variables: [
      { key: "NODE_ENV", value: "test", required: true },
      { key: "T3CODE_TRACE_MIN_LEVEL", value: "Info", required: false },
    ],
    description: "自动化测试环境配置",
    isDefault: false,
  },
  {
    id: "template-prod",
    name: "生产环境",
    type: "production",
    variables: [
      { key: "NODE_ENV", value: "production", required: true },
      { key: "T3CODE_TRACE_MIN_LEVEL", value: "Warn", required: false },
    ],
    description: "生产环境配置",
    isDefault: false,
  },
];

// -----------------------------------------------------------------------------
// Environment Manager Live Implementation
// -----------------------------------------------------------------------------

export const makeEnvironmentManager = Effect.gen(function* () {
  const profilesRef = yield* Ref.make<Map<string, EnvironmentProfile>>(new Map());
  const templatesRef = yield* Ref.make<EnvironmentTemplate[]>(DEFAULT_TEMPLATES);

  const listTemplates: EnvironmentManagerShape["listTemplates"] = Effect.fn(
    "EnvironmentManager.listTemplates",
  )(function* () {
    return yield* Ref.get(templatesRef);
  });

  const getTemplate: EnvironmentManagerShape["getTemplate"] = Effect.fn(
    "EnvironmentManager.getTemplate",
  )(function* (templateId: string) {
    const templates = yield* Ref.get(templatesRef);
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      return yield* new EnvironmentConfigNotFoundError({
        environmentId: templateId as EnvironmentId,
      });
    }
    return template;
  });

  const createProfile: EnvironmentManagerShape["createProfile"] = Effect.fn(
    "EnvironmentManager.createProfile",
  )(function* (params: { name: string; templateId?: string }) {
    const now = new Date().toISOString();
    const profile: EnvironmentProfile = {
      id: `profile-${Date.now()}`,
      name: params.name,
      configs: {} as Record<EnvironmentId, EnvironmentConfig>,
      activeEnvironmentId: "default" as EnvironmentId,
      createdAt: now,
      updatedAt: now,
    };

    yield* Ref.update(profilesRef, (profiles) => {
      const newProfiles = new Map(profiles);
      newProfiles.set(profile.id, profile);
      return newProfiles;
    });

    return profile;
  });

  const getProfile: EnvironmentManagerShape["getProfile"] = Effect.fn(
    "EnvironmentManager.getProfile",
  )(function* (profileId: string) {
    const profiles = yield* Ref.get(profilesRef);
    const profile = profiles.get(profileId);
    if (!profile) {
      return yield* new EnvironmentProfileNotFoundError({ profileId });
    }
    return profile;
  });

  const listProfiles: EnvironmentManagerShape["listProfiles"] = Effect.fn(
    "EnvironmentManager.listProfiles",
  )(function* () {
    const profiles = yield* Ref.get(profilesRef);
    return Array.from(profiles.values());
  });

  const deleteProfile: EnvironmentManagerShape["deleteProfile"] = Effect.fn(
    "EnvironmentManager.deleteProfile",
  )(function* (profileId: string) {
    const profiles = yield* Ref.get(profilesRef);
    if (!profiles.has(profileId)) {
      return yield* new EnvironmentProfileNotFoundError({ profileId });
    }
    yield* Ref.update(profilesRef, (p) => {
      const next = new Map(p);
      next.delete(profileId);
      return next;
    });
  });

  const switchEnvironment: EnvironmentManagerShape["switchEnvironment"] = Effect.fn(
    "EnvironmentManager.switchEnvironment",
  )(function* (params: { profileId: string; environmentId: EnvironmentId }) {
    const profiles = yield* Ref.get(profilesRef);
    const profile = profiles.get(params.profileId);
    if (!profile) {
      return yield* new EnvironmentProfileNotFoundError({ profileId: params.profileId });
    }

    const updatedProfile: EnvironmentProfile = {
      ...profile,
      activeEnvironmentId: params.environmentId,
      updatedAt: new Date().toISOString(),
    };

    yield* Ref.update(profilesRef, (p) => {
      const newProfiles = new Map(p);
      newProfiles.set(params.profileId, updatedProfile);
      return newProfiles;
    });

    return updatedProfile;
  });

  const compareConfigs: EnvironmentManagerShape["compareConfigs"] = Effect.fn(
    "EnvironmentManager.compareConfigs",
  )(function* (params: { baseEnvironmentId: EnvironmentId; targetEnvironmentId: EnvironmentId }) {
    return {
      baseEnvironmentId: params.baseEnvironmentId,
      targetEnvironmentId: params.targetEnvironmentId,
      diffs: [],
    } as ConfigDiff;
  });

  const analyzeDependencies: EnvironmentManagerShape["analyzeDependencies"] = Effect.fn(
    "EnvironmentManager.analyzeDependencies",
  )(function* (workspaceRoot: string) {
    const packageJsonPath = Path.join(workspaceRoot, "package.json");

    const content = yield* Effect.tryPromise({
      try: () => FS.readFile(packageJsonPath, "utf-8"),
      catch: (e) =>
        new DependencyAnalysisError({
          message: "Failed to read package.json",
          cause: e instanceof Error ? e.message : String(e),
        }),
    });

    const packageJson = yield* Effect.try({
      try: () =>
        JSON.parse(content) as {
          name?: string;
          version?: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        },
      catch: (e) =>
        new DependencyAnalysisError({
          message: "Invalid package.json",
          cause: e instanceof Error ? e.message : String(e),
        }),
    });

    const dependencies: PackageDependency[] = [];
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};

    for (const [name, version] of Object.entries(deps)) {
      dependencies.push({
        name,
        version: String(version),
        type: "production",
      });
    }

    for (const [name, version] of Object.entries(devDeps)) {
      dependencies.push({
        name,
        version: String(version),
        type: "development",
      });
    }

    const node: PackageNode = {
      name: packageJson.name || "root",
      version: packageJson.version || "0.0.0",
      dependencies,
      depth: 0,
    };

    return {
      rootPackage: packageJson.name || "root",
      nodes: [node],
      totalCount: 1 + dependencies.length,
      maxDepth: 1,
    } as DependencyTree;
  });

  const checkCompatibility: EnvironmentManagerShape["checkCompatibility"] = Effect.fn(
    "EnvironmentManager.checkCompatibility",
  )(function* (params: { packageName: string; currentVersion: string }) {
    return {
      packageName: params.packageName,
      currentVersion: params.currentVersion,
      status: "compatible" as const,
    } as VersionCompatibilityResult;
  });

  const getUpdateSuggestions: EnvironmentManagerShape["getUpdateSuggestions"] = Effect.fn(
    "EnvironmentManager.getUpdateSuggestions",
  )(function* (workspaceRoot: string) {
    const tree = yield* analyzeDependencies(workspaceRoot);
    const suggestions: DependencyUpdateSuggestion[] = [];
    const rootNode = tree.nodes[0];
    if (!rootNode) {
      return suggestions;
    }

    const loosePattern = /[*]|^[\^~]|latest|\sx\.|\.x\b/i;
    for (const dep of rootNode.dependencies) {
      const raw = dep.version;
      if (loosePattern.test(raw)) {
        suggestions.push({
          packageName: dep.name,
          currentVersion: raw,
          suggestedVersion: "Pin explicit semver",
          riskLevel: "major",
          breakingChanges: ["Floating ranges may resolve differently across machines and CI"],
        });
      }
    }

    return suggestions;
  });

  const exportEnvironment: EnvironmentManagerShape["exportEnvironment"] = Effect.fn(
    "EnvironmentManager.exportEnvironment",
  )(function* (request: EnvironmentExportRequest) {
    const profiles = yield* Ref.get(profilesRef);
    const profile = profiles.get(request.profileId);

    if (!profile) {
      return yield* new EnvironmentExportError({
        message: `Profile not found: ${request.profileId}`,
        format: request.format,
      });
    }

    const content = JSON.stringify(profile, null, 2);

    return {
      content,
      format: request.format,
      exportedAt: new Date().toISOString(),
      environmentCount: Object.keys(profile.configs).length,
    } as EnvironmentExportResult;
  });

  const importEnvironment: EnvironmentManagerShape["importEnvironment"] = Effect.fn(
    "EnvironmentManager.importEnvironment",
  )(function* (request: EnvironmentImportRequest) {
    const content = yield* Effect.promise(() => FS.readFile(request.sourcePath, "utf-8"));
    const imported = JSON.parse(content as string);

    const importedEnvironments = Object.keys(imported.configs || {}).length;

    return {
      importedVariables: 0,
      importedEnvironments,
      warnings: [],
    } as EnvironmentImportResult;
  });

  return {
    listTemplates,
    getTemplate,
    createProfile,
    getProfile,
    listProfiles,
    deleteProfile,
    switchEnvironment,
    compareConfigs,
    analyzeDependencies,
    checkCompatibility,
    getUpdateSuggestions,
    exportEnvironment,
    importEnvironment,
  } satisfies EnvironmentManagerShape;
});

export const EnvironmentManagerLive = Layer.effect(EnvironmentManager, makeEnvironmentManager);
