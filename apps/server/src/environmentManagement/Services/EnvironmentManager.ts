/**
 * EnvironmentManager - Service contract for multi-environment configuration management.
 *
 * Provides interfaces for:
 * - Environment templates and profiles
 * - Configuration comparison and diff
 * - Dependency visualization
 * - Export/import functionality
 *
 * @module EnvironmentManager
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";
import {
  EnvironmentTemplate,
  EnvironmentConfig,
  EnvironmentProfile,
  ConfigDiff,
  DependencyTree,
  VersionCompatibilityResult,
  DependencyUpdateSuggestion,
  EnvironmentExportRequest,
  EnvironmentExportResult,
  EnvironmentImportRequest,
  EnvironmentImportResult,
  EnvironmentId,
} from "@t3tools/contracts";

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class EnvironmentProfileNotFoundError extends Schema.TaggedErrorClass<EnvironmentProfileNotFoundError>()(
  "EnvironmentProfileNotFoundError",
  {
    profileId: Schema.String,
  },
) {
  override get message(): string {
    return `Environment profile not found: ${this.profileId}`;
  }
}

export class EnvironmentConfigNotFoundError extends Schema.TaggedErrorClass<EnvironmentConfigNotFoundError>()(
  "EnvironmentConfigNotFoundError",
  {
    environmentId: Schema.String,
  },
) {
  override get message(): string {
    return `Environment config not found: ${this.environmentId}`;
  }
}

export class DependencyAnalysisError extends Schema.TaggedErrorClass<DependencyAnalysisError>()(
  "DependencyAnalysisError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    return `Dependency analysis failed: ${this.message}`;
  }
}

export class EnvironmentExportError extends Schema.TaggedErrorClass<EnvironmentExportError>()(
  "EnvironmentExportError",
  {
    message: Schema.String,
    format: Schema.String,
  },
) {
  override get message(): string {
    return `Environment export failed (${this.format}): ${this.message}`;
  }
}

export class EnvironmentImportError extends Schema.TaggedErrorClass<EnvironmentImportError>()(
  "EnvironmentImportError",
  {
    message: Schema.String,
    sourcePath: Schema.String,
  },
) {
  override get message(): string {
    return `Environment import failed from ${this.sourcePath}: ${this.message}`;
  }
}

export const EnvironmentManagerError = Schema.Union([
  EnvironmentProfileNotFoundError,
  EnvironmentConfigNotFoundError,
  DependencyAnalysisError,
  EnvironmentExportError,
  EnvironmentImportError,
]);
export type EnvironmentManagerError = typeof EnvironmentManagerError.Type;

// -----------------------------------------------------------------------------
// Service Shape
// -----------------------------------------------------------------------------

/**
 * EnvironmentManagerShape - Service API for environment configuration management.
 */
export interface EnvironmentManagerShape {
  /**
   * List all available environment templates.
   */
  readonly listTemplates: () => Effect.Effect<EnvironmentTemplate[], never>;

  /**
   * Get an environment template by ID.
   */
  readonly getTemplate: (
    templateId: string,
  ) => Effect.Effect<EnvironmentTemplate, EnvironmentConfigNotFoundError>;

  /**
   * Create a new environment profile.
   */
  readonly createProfile: (params: {
    name: string;
    templateId?: string;
  }) => Effect.Effect<EnvironmentProfile, EnvironmentManagerError>;

  /**
   * Get an environment profile by ID.
   */
  readonly getProfile: (
    profileId: string,
  ) => Effect.Effect<EnvironmentProfile, EnvironmentProfileNotFoundError>;

  /**
   * List all environment profiles.
   */
  readonly listProfiles: () => Effect.Effect<EnvironmentProfile[], never>;

  /**
   * Delete an environment profile.
   */
  readonly deleteProfile: (
    profileId: string,
  ) => Effect.Effect<void, EnvironmentProfileNotFoundError>;

  /**
   * Switch active environment in a profile.
   */
  readonly switchEnvironment: (params: {
    profileId: string;
    environmentId: EnvironmentId;
  }) => Effect.Effect<EnvironmentProfile, EnvironmentProfileNotFoundError>;

  /**
   * Compare two environment configs and generate diff.
   */
  readonly compareConfigs: (params: {
    baseEnvironmentId: EnvironmentId;
    targetEnvironmentId: EnvironmentId;
  }) => Effect.Effect<ConfigDiff, EnvironmentConfigNotFoundError>;

  /**
   * Analyze package dependencies.
   */
  readonly analyzeDependencies: (
    workspaceRoot: string,
  ) => Effect.Effect<DependencyTree, DependencyAnalysisError>;

  /**
   * Check version compatibility for dependencies.
   */
  readonly checkCompatibility: (params: {
    packageName: string;
    currentVersion: string;
  }) => Effect.Effect<VersionCompatibilityResult, DependencyAnalysisError>;

  /**
   * Get dependency update suggestions.
   */
  readonly getUpdateSuggestions: (
    workspaceRoot: string,
  ) => Effect.Effect<DependencyUpdateSuggestion[], DependencyAnalysisError>;

  /**
   * Export environment configuration.
   */
  readonly exportEnvironment: (
    request: EnvironmentExportRequest,
  ) => Effect.Effect<EnvironmentExportResult, EnvironmentExportError>;

  /**
   * Import environment configuration.
   */
  readonly importEnvironment: (
    request: EnvironmentImportRequest,
  ) => Effect.Effect<EnvironmentImportResult, EnvironmentImportError>;
}

// -----------------------------------------------------------------------------
// Service Tag
// -----------------------------------------------------------------------------

/**
 * EnvironmentManager - Service tag for environment configuration management.
 */
export class EnvironmentManager extends Context.Service<
  EnvironmentManager,
  EnvironmentManagerShape
>()("t3/environmentManagement/Services/EnvironmentManager") {}
