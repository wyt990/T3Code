import * as FS from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, normalize, relative } from "node:path";

import { resolveTsconfigPathsImport } from "./tsconfigPathsResolve.ts";
import {
  parseBareModuleSpecifier,
  resolveBareSpecifierToWorkspaceRel,
  type WorkspacePackageIndex,
} from "./workspacePackageResolve.ts";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function pathExistsFile(
  abs: string,
  workspaceRoot: string,
  existenceCache: Map<string, boolean>,
): Promise<boolean> {
  const rel = relative(workspaceRoot, abs).replace(/\\/g, "/");
  if (rel.startsWith("..") || rel.length === 0) {
    return false;
  }
  let ok = existenceCache.get(rel);
  if (ok === undefined) {
    try {
      const st = await FS.stat(abs);
      ok = st.isFile();
    } catch {
      ok = false;
    }
    existenceCache.set(rel, ok);
  }
  return ok;
}

async function resolveRelativeSpecifier(
  spec: string,
  sourceAbs: string,
  workspaceRoot: string,
  existenceCache: Map<string, boolean>,
): Promise<string | null> {
  if (!spec.startsWith(".") && !spec.startsWith("/")) {
    return null;
  }
  const baseDir = dirname(sourceAbs);
  const joined = normalize(
    spec.startsWith("/") ? join(workspaceRoot, spec.slice(1)) : join(baseDir, spec),
  );
  const candidates: string[] = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}.mjs`,
    `${joined}.cjs`,
    join(joined, "index.ts"),
    join(joined, "index.tsx"),
    join(joined, "index.js"),
  ];
  for (const abs of candidates) {
    if (await pathExistsFile(abs, workspaceRoot, existenceCache)) {
      const rel = relative(workspaceRoot, abs).replace(/\\/g, "/");
      if (!rel.startsWith("..") && rel.length > 0) {
        return rel;
      }
    }
  }
  return null;
}

function externalIdFromBareSpecifier(spec: string): string | null {
  const parsed = parseBareModuleSpecifier(spec);
  if (!parsed) {
    return null;
  }
  return `nm:${parsed.name}`;
}

function tryResolveExternalWithRequire(spec: string, sourceAbs: string): string | null {
  if (spec.startsWith("node:")) {
    return null;
  }
  const extId = externalIdFromBareSpecifier(spec);
  if (!extId) {
    return null;
  }
  try {
    const req = createRequire(sourceAbs);
    req.resolve(spec);
    return extId;
  } catch {
    return null;
  }
}

async function resolveImportSpecifierUnified(
  spec: string,
  sourceAbs: string,
  workspaceRoot: string,
  pkgIndex: WorkspacePackageIndex,
  existenceCache: Map<string, boolean>,
): Promise<string | null> {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const relHit = await resolveRelativeSpecifier(trimmed, sourceAbs, workspaceRoot, existenceCache);
  if (relHit) {
    return relHit;
  }

  const tsHit = await resolveTsconfigPathsImport(trimmed, sourceAbs, workspaceRoot, existenceCache);
  if (tsHit) {
    return tsHit;
  }

  const ws = await resolveBareSpecifierToWorkspaceRel(
    trimmed,
    workspaceRoot,
    pkgIndex,
    existenceCache,
  );
  if (ws) {
    return ws;
  }

  return tryResolveExternalWithRequire(trimmed, sourceAbs);
}

/** 常规 import / side-effect / dynamic / require 的说明符 */
export function collectImportLikeSpecifiers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    out.add(m[1]!);
  }
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.add(m[1]!);
  }
  for (const m of text.matchAll(/\bimport\s+['"]([^'"]+)['"]\s*;?/g)) {
    out.add(m[1]!);
  }
  for (const m of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.add(m[1]!);
  }
  return [...out];
}

/** `export … from 'x'` 的说明符 */
export function collectReexportSpecifiers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bexport\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g)) {
    out.add(m[1]!);
  }
  return [...out];
}

export async function extractResolvedImportLikeTargets(
  sourceAbs: string,
  workspaceRoot: string,
  text: string,
  pkgIndex: WorkspacePackageIndex,
  existenceCache: Map<string, boolean>,
): Promise<{ rels: string[]; externalIds: string[] }> {
  const rels = new Set<string>();
  const externalIds = new Set<string>();
  for (const spec of collectImportLikeSpecifiers(text)) {
    const hit = await resolveImportSpecifierUnified(
      spec,
      sourceAbs,
      workspaceRoot,
      pkgIndex,
      existenceCache,
    );
    if (!hit) {
      continue;
    }
    if (hit.startsWith("nm:")) {
      externalIds.add(hit);
    } else {
      rels.add(hit);
    }
  }
  return { rels: [...rels], externalIds: [...externalIds] };
}

export async function extractResolvedReexportTargetsUnified(
  sourceAbs: string,
  workspaceRoot: string,
  text: string,
  pkgIndex: WorkspacePackageIndex,
  existenceCache: Map<string, boolean>,
): Promise<{ rels: string[]; externalIds: string[] }> {
  const rels = new Set<string>();
  const externalIds = new Set<string>();
  for (const spec of collectReexportSpecifiers(text)) {
    const hit = await resolveImportSpecifierUnified(
      spec,
      sourceAbs,
      workspaceRoot,
      pkgIndex,
      existenceCache,
    );
    if (!hit) {
      continue;
    }
    if (hit.startsWith("nm:")) {
      externalIds.add(hit);
    } else {
      rels.add(hit);
    }
  }
  return { rels: [...rels], externalIds: [...externalIds] };
}

export async function buildSpecifierResolutionMap(
  sourceAbs: string,
  workspaceRoot: string,
  text: string,
  pkgIndex: WorkspacePackageIndex,
  existenceCache: Map<string, boolean>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const specs = new Set<string>([
    ...collectImportLikeSpecifiers(text),
    ...collectReexportSpecifiers(text),
  ]);
  for (const spec of specs) {
    const hit = await resolveImportSpecifierUnified(
      spec,
      sourceAbs,
      workspaceRoot,
      pkgIndex,
      existenceCache,
    );
    if (hit) {
      map.set(spec, hit);
    }
  }
  return map;
}

function parseNamedImportBindings(inner: string): string[] {
  const names: string[] = [];
  for (const raw of inner.split(",")) {
    const p = raw.trim();
    if (!p) {
      continue;
    }
    const asMatch = p.match(/^(\w+)\s+as\s+(\w+)$/);
    if (asMatch?.[2]) {
      names.push(asMatch[2]);
      continue;
    }
    const id = p.match(/^(\w+)$/);
    if (id?.[1]) {
      names.push(id[1]);
    }
  }
  return names;
}

/**
 * 将 import 子句中的本地绑定映射到 `buildSpecifierResolutionMap` 解析后的目标（工作区路径或 `nm:`）。
 */
export function extractImportBindingTargets(
  text: string,
  resMap: ReadonlyMap<string, string>,
): Map<string, string> {
  const bindings = new Map<string, string>();
  const re = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const clause = m[1]!.trim();
    const spec = m[2]!;
    const target = resMap.get(spec);
    if (!target) {
      continue;
    }
    if (/^\s*type\s/.test(clause)) {
      continue;
    }
    let c = clause.replace(/^\s*type\s+/, "").trim();
    if (c.startsWith("*")) {
      const star = c.match(/^\*\s+as\s+(\w+)/);
      if (star?.[1]) {
        bindings.set(star[1], target);
      }
      continue;
    }
    if (c.startsWith("{")) {
      const end = c.indexOf("}");
      if (end === -1) {
        continue;
      }
      const inner = c.slice(1, end);
      for (const n of parseNamedImportBindings(inner)) {
        bindings.set(n, target);
      }
      continue;
    }
    const brace = c.indexOf("{");
    if (brace !== -1) {
      const defPart = c.slice(0, brace).replace(/,$/, "").trim();
      const namedPart = c.slice(brace);
      const defM = defPart.match(/^(\w+)$/);
      if (defM?.[1]) {
        bindings.set(defM[1], target);
      }
      const end = namedPart.indexOf("}");
      if (end !== -1) {
        const inner = namedPart.slice(1, end);
        for (const n of parseNamedImportBindings(inner)) {
          bindings.set(n, target);
        }
      }
      continue;
    }
    const only = c.match(/^(\w+)$/);
    if (only?.[1]) {
      bindings.set(only[1], target);
    }
  }
  return bindings;
}

export function extractApproximateCallEdges(
  fromFileRel: string,
  text: string,
  bindingTargets: ReadonlyMap<string, string>,
): Array<{ readonly from: string; readonly to: string }> {
  const out: Array<{ readonly from: string; readonly to: string }> = [];
  const seen = new Set<string>();
  for (const [localName, target] of bindingTargets) {
    if (!/^[A-Za-z_$][\w$]*$/.test(localName)) {
      continue;
    }
    const callRe = new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(`, "g");
    let hit: RegExpExecArray | null;
    while ((hit = callRe.exec(text)) !== null) {
      const key = `${fromFileRel}\t${target}\t${hit.index}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({ from: fromFileRel, to: target });
    }
  }
  return out;
}
