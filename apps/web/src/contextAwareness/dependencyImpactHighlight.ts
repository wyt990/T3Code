import type { ChangeImpact } from "@t3tools/contracts";

/** 与依赖图节点 `path` 一致：正斜杠、trim。 */
export function normalizeModulePath(p: string): string {
  return p.trim().replace(/\\/g, "/");
}

export type DependencyImpactHighlight = {
  readonly changedFile: string;
  readonly directImporterPaths: ReadonlySet<string>;
  readonly transitiveImporterPaths: ReadonlySet<string>;
};

export function buildImpactHighlightFromChangeImpact(
  impact: ChangeImpact | null,
): DependencyImpactHighlight | null {
  if (impact === null) {
    return null;
  }
  const changedFile = normalizeModulePath(impact.changedFile);
  const directImporterPaths = new Set(impact.affectedFiles.map(normalizeModulePath));
  const transitiveImporterPaths = new Set(
    (impact.transitiveImporters ?? []).map(normalizeModulePath),
  );
  return { changedFile, directImporterPaths, transitiveImporterPaths };
}

export function impactTierForPath(
  path: string,
  highlight: DependencyImpactHighlight | null,
): "changed" | "direct" | "transitive" | "none" {
  if (highlight === null) {
    return "none";
  }
  const p = normalizeModulePath(path);
  if (p === highlight.changedFile) {
    return "changed";
  }
  if (highlight.directImporterPaths.has(p)) {
    return "direct";
  }
  if (highlight.transitiveImporterPaths.has(p)) {
    return "transitive";
  }
  return "none";
}
