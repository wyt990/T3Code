import * as FS from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

/** 自 `tsconfig.json` 所在目录解析出的 paths + baseUrl（绝对路径）。 */
export interface TsconfigPathsContext {
  readonly configDirAbs: string;
  readonly baseUrlAbs: string;
  /** pattern 越长越靠前，优先匹配更具体的映射 */
  readonly pathMappings: ReadonlyArray<{
    readonly pattern: string;
    readonly targets: readonly string[];
  }>;
}

const pathsCache = new Map<string, TsconfigPathsContext | null>();

function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+\/\/.*$/g, "");
}

async function pathExistsFile(abs: string): Promise<boolean> {
  try {
    const st = await FS.stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

function matchSingleStarPattern(importSpec: string, pattern: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) {
    return importSpec === pattern ? "" : null;
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!importSpec.startsWith(prefix)) {
    return null;
  }
  if (suffix.length > 0 && !importSpec.endsWith(suffix)) {
    return null;
  }
  const mid = importSpec.slice(
    prefix.length,
    suffix.length > 0 ? importSpec.length - suffix.length : undefined,
  );
  return mid;
}

async function resolveTargetToWorkspaceRel(
  workspaceRoot: string,
  baseUrlAbs: string,
  targetTemplate: string,
  captured: string,
  existenceCache: Map<string, boolean>,
): Promise<string | null> {
  const replaced = targetTemplate.includes("*")
    ? targetTemplate.replace(/\*/g, captured)
    : targetTemplate;
  const absBase = normalize(join(baseUrlAbs, replaced.replace(/^\.\//, "")));
  const candidates: string[] = [
    absBase,
    `${absBase}.ts`,
    `${absBase}.tsx`,
    `${absBase}.js`,
    `${absBase}.jsx`,
    `${absBase}.mjs`,
    `${absBase}/index.ts`,
    `${absBase}/index.tsx`,
    `${absBase}/index.js`,
  ];
  for (const abs of candidates) {
    const rel = relative(workspaceRoot, abs).replace(/\\/g, "/");
    if (rel.startsWith("..") || rel.length === 0) {
      continue;
    }
    let ok = existenceCache.get(rel);
    if (ok === undefined) {
      ok = await pathExistsFile(abs);
      existenceCache.set(rel, ok);
    }
    if (ok) {
      return rel;
    }
  }
  return null;
}

async function readTsconfigPathsContext(
  configDirAbs: string,
): Promise<TsconfigPathsContext | null> {
  const cached = pathsCache.get(configDirAbs);
  if (cached !== undefined) {
    return cached;
  }
  const tcPath = join(configDirAbs, "tsconfig.json");
  let raw: string;
  try {
    raw = await FS.readFile(tcPath, "utf-8");
  } catch {
    pathsCache.set(configDirAbs, null);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw)) as unknown;
  } catch {
    pathsCache.set(configDirAbs, null);
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    pathsCache.set(configDirAbs, null);
    return null;
  }
  const co = (parsed as { compilerOptions?: unknown }).compilerOptions;
  if (!co || typeof co !== "object" || Array.isArray(co)) {
    pathsCache.set(configDirAbs, null);
    return null;
  }
  const pathsField = (co as { paths?: unknown }).paths;
  const baseUrlRel =
    typeof (co as { baseUrl?: unknown }).baseUrl === "string"
      ? ((co as { baseUrl: string }).baseUrl as string)
      : ".";
  const baseUrlAbs = normalize(join(configDirAbs, baseUrlRel));
  if (!pathsField || typeof pathsField !== "object" || Array.isArray(pathsField)) {
    const ctx: TsconfigPathsContext = {
      configDirAbs,
      baseUrlAbs,
      pathMappings: [],
    };
    pathsCache.set(configDirAbs, ctx);
    return ctx;
  }
  const entries: Array<{ pattern: string; targets: string[] }> = [];
  for (const [pattern, targetsRaw] of Object.entries(pathsField as Record<string, unknown>)) {
    if (!Array.isArray(targetsRaw) || targetsRaw.length === 0) {
      continue;
    }
    const targets = targetsRaw.filter((t): t is string => typeof t === "string" && t.length > 0);
    if (targets.length === 0) {
      continue;
    }
    entries.push({ pattern, targets });
  }
  entries.sort((a, b) => b.pattern.length - a.pattern.length);
  const ctx: TsconfigPathsContext = {
    configDirAbs,
    baseUrlAbs,
    pathMappings: entries,
  };
  pathsCache.set(configDirAbs, ctx);
  return ctx;
}

/**
 * 自源文件路径向上查找最近的 `tsconfig.json` 并解析 `compilerOptions.paths`。
 */
export async function loadNearestTsconfigPaths(
  sourceFileAbs: string,
  workspaceRoot: string,
): Promise<TsconfigPathsContext | null> {
  const root = normalize(workspaceRoot);
  let dir = normalize(dirname(sourceFileAbs));
  for (;;) {
    const ctx = await readTsconfigPathsContext(dir);
    if (ctx !== null && ctx.pathMappings.length > 0) {
      return ctx;
    }
    if (dir === root) {
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return await readTsconfigPathsContext(root);
}

/**
 * 尝试将非相对说明符解析为工作区相对路径（命中 `paths` 映射且目标文件存在）。
 */
export async function resolveTsconfigPathsImport(
  importSpec: string,
  sourceFileAbs: string,
  workspaceRoot: string,
  existenceCache: Map<string, boolean>,
): Promise<string | null> {
  const ctx = await loadNearestTsconfigPaths(sourceFileAbs, workspaceRoot);
  if (ctx === null || ctx.pathMappings.length === 0) {
    return null;
  }
  for (const { pattern, targets } of ctx.pathMappings) {
    const cap = matchSingleStarPattern(importSpec, pattern);
    if (cap === null) {
      continue;
    }
    for (const t of targets) {
      const hit = await resolveTargetToWorkspaceRel(
        workspaceRoot,
        ctx.baseUrlAbs,
        t,
        cap,
        existenceCache,
      );
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

/** 测试用：清空 tsconfig 解析缓存 */
export function clearTsconfigPathsCacheForTests(): void {
  pathsCache.clear();
}
