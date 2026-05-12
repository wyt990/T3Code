/**
 * Environment management enhancement schemas for multi-environment configuration.
 *
 * @module environmentManagement
 */
import { Effect, Schema } from "effect";
import { EnvironmentId, TrimmedNonEmptyString } from "./baseSchemas.ts";

// -----------------------------------------------------------------------------
// Environment Templates
// -----------------------------------------------------------------------------

export const EnvironmentTemplateType = Schema.Literals([
  "development",
  "testing",
  "production",
  "custom",
]);
export type EnvironmentTemplateType = typeof EnvironmentTemplateType.Type;

export const EnvironmentVariable = Schema.Struct({
  key: TrimmedNonEmptyString,
  value: Schema.String,
  description: Schema.optionalKey(Schema.String),
  required: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type EnvironmentVariable = typeof EnvironmentVariable.Type;

export const EnvironmentTemplate = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  type: EnvironmentTemplateType,
  variables: Schema.Array(EnvironmentVariable),
  description: Schema.optionalKey(Schema.String),
  isDefault: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type EnvironmentTemplate = typeof EnvironmentTemplate.Type;

// -----------------------------------------------------------------------------
// Environment Configuration
// -----------------------------------------------------------------------------

export const EnvironmentConfig = Schema.Struct({
  environmentId: EnvironmentId,
  templateId: Schema.optionalKey(TrimmedNonEmptyString),
  customVariables: Schema.Array(EnvironmentVariable),
  serverPort: Schema.optionalKey(Schema.Number),
  homeDirectory: Schema.optionalKey(TrimmedNonEmptyString),
  observabilityEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  otlpTracesUrl: Schema.optionalKey(Schema.String),
  otlpMetricsUrl: Schema.optionalKey(Schema.String),
});
export type EnvironmentConfig = typeof EnvironmentConfig.Type;

// -----------------------------------------------------------------------------
// Environment Profile
// -----------------------------------------------------------------------------

export const EnvironmentProfile = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  configs: Schema.Record(EnvironmentId, EnvironmentConfig),
  activeEnvironmentId: EnvironmentId,
  createdAt: Schema.String, // ISO timestamp
  updatedAt: Schema.String, // ISO timestamp
});
export type EnvironmentProfile = typeof EnvironmentProfile.Type;

// -----------------------------------------------------------------------------
// Config Diff
// -----------------------------------------------------------------------------

export const ConfigDiffType = Schema.Literals(["added", "removed", "modified", "unchanged"]);
export type ConfigDiffType = typeof ConfigDiffType.Type;

export const ConfigDiffEntry = Schema.Struct({
  key: TrimmedNonEmptyString,
  diffType: ConfigDiffType,
  oldValue: Schema.optionalKey(Schema.String),
  newValue: Schema.optionalKey(Schema.String),
});
export type ConfigDiffEntry = typeof ConfigDiffEntry.Type;

export const ConfigDiff = Schema.Struct({
  baseEnvironmentId: EnvironmentId,
  targetEnvironmentId: EnvironmentId,
  diffs: Schema.Array(ConfigDiffEntry),
});
export type ConfigDiff = typeof ConfigDiff.Type;

// -----------------------------------------------------------------------------
// Dependency Visualization
// -----------------------------------------------------------------------------

export const PackageDependency = Schema.Struct({
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  type: Schema.Literals(["production", "development", "peer", "optional"]),
  resolvedVersion: Schema.optionalKey(TrimmedNonEmptyString),
});
export type PackageDependency = typeof PackageDependency.Type;

export const PackageNode = Schema.Struct({
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  dependencies: Schema.Array(PackageDependency),
  depth: Schema.Number,
});
export type PackageNode = typeof PackageNode.Type;

export const DependencyTree = Schema.Struct({
  rootPackage: TrimmedNonEmptyString,
  nodes: Schema.Array(PackageNode),
  totalCount: Schema.Number,
  maxDepth: Schema.Number,
});
export type DependencyTree = typeof DependencyTree.Type;

// -----------------------------------------------------------------------------
// Version Compatibility
// -----------------------------------------------------------------------------

export const CompatibilityStatus = Schema.Literals([
  "compatible",
  "warning",
  "incompatible",
  "unknown",
]);
export type CompatibilityStatus = typeof CompatibilityStatus.Type;

export const VersionCompatibilityResult = Schema.Struct({
  packageName: TrimmedNonEmptyString,
  currentVersion: TrimmedNonEmptyString,
  requiredRange: Schema.optionalKey(Schema.String),
  status: CompatibilityStatus,
  reason: Schema.optionalKey(Schema.String),
});
export type VersionCompatibilityResult = typeof VersionCompatibilityResult.Type;

// -----------------------------------------------------------------------------
// Dependency Update Suggestion
// -----------------------------------------------------------------------------

export const UpdateRisk = Schema.Literals(["safe", "minor", "major", "breaking"]);
export type UpdateRisk = typeof UpdateRisk.Type;

export const DependencyUpdateSuggestion = Schema.Struct({
  packageName: TrimmedNonEmptyString,
  currentVersion: TrimmedNonEmptyString,
  suggestedVersion: TrimmedNonEmptyString,
  riskLevel: UpdateRisk,
  changelogUrl: Schema.optionalKey(Schema.String),
  breakingChanges: Schema.Array(Schema.String),
});
export type DependencyUpdateSuggestion = typeof DependencyUpdateSuggestion.Type;

// -----------------------------------------------------------------------------
// Dependency security audit (npm audit / bun audit JSON)
// -----------------------------------------------------------------------------

export const DependencyAuditSeverity = Schema.Literals([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
]);
export type DependencyAuditSeverity = typeof DependencyAuditSeverity.Type;

export const DependencyAuditFinding = Schema.Struct({
  packageName: TrimmedNonEmptyString,
  severity: DependencyAuditSeverity,
  title: TrimmedNonEmptyString,
  range: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
});
export type DependencyAuditFinding = typeof DependencyAuditFinding.Type;

// -----------------------------------------------------------------------------
// Environment Export/Import
// -----------------------------------------------------------------------------

export const EnvironmentExportFormat = Schema.Literals(["json", "yaml", "env-file"]);
export type EnvironmentExportFormat = typeof EnvironmentExportFormat.Type;

export const EnvironmentExportRequest = Schema.Struct({
  profileId: TrimmedNonEmptyString,
  format: EnvironmentExportFormat,
  includeSecrets: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  targetPath: Schema.optionalKey(TrimmedNonEmptyString),
});
export type EnvironmentExportRequest = typeof EnvironmentExportRequest.Type;

export const EnvironmentImportRequest = Schema.Struct({
  sourcePath: TrimmedNonEmptyString,
  format: EnvironmentExportFormat,
  targetProfileId: Schema.optionalKey(TrimmedNonEmptyString),
  mergeStrategy: Schema.Literals(["replace", "merge", "append"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("merge")),
  ),
});
export type EnvironmentImportRequest = typeof EnvironmentImportRequest.Type;

export const EnvironmentExportResult = Schema.Struct({
  content: Schema.String,
  format: EnvironmentExportFormat,
  exportedAt: Schema.String, // ISO timestamp
  environmentCount: Schema.Number,
});
export type EnvironmentExportResult = typeof EnvironmentExportResult.Type;

export const EnvironmentImportResult = Schema.Struct({
  importedVariables: Schema.Number,
  importedEnvironments: Schema.Number,
  warnings: Schema.Array(Schema.String),
});
export type EnvironmentImportResult = typeof EnvironmentImportResult.Type;
