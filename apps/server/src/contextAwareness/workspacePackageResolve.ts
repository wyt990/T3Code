import type { Dirent } from "node:fs";
import * as FS from "node:fs/promises";
import { join, normalize, relative } from "node:path";

/** 工作区内 `package.json` 的 name → 包根目录（相对 workspaceRoot，POSIX） */
export type WorkspacePackageIndex = ReadonlyMap<
  string,
  Readonly<{ rootRel: string; pkg: Readonly<Record<string, unknown>> }>
>;

function toPosixRel(workspaceRoot: string, absPath: string): string | null {
  const rel = relative(workspaceRoot, absPath).replace(/\\/g, "/");
  if (rel.startsWith("..") || rel.length === 0) {
    return null;
  }
  return rel;
}

/** 解析裸模块说明符为包名 + 子路径（不含包名内的 scope） */
export function parseBareModuleSpecifier(spec: string): { name: string; subpath: string } | null {
  const s = spec.trim();
  if (s.length === 0 || s.startsWith(".") || s.startsWith("/") || s.startsWith("node:")) {
    return null;
  }
  if (s.startsWith("@")) {
    const m = s.match(/^(@[^/]+\/[^/]+)(?:\/(.*))?$/);
    if (!m?.[1]) {
      return null;
    }
    return { name: m[1], subpath: (m[2] ?? "").replace(/^\/+/, "") };
  }
  const slash = s.indexOf("/");
  if (slash === -1) {
    return { name: s, subpath: "" };
  }
  return { name: s.slice(0, slash), subpath: s.slice(slash + 1).replace(/^\/+/, "") };
}

function pickStringFromExportEntry(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry;
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const o = entry as Record<string, unknown>;
    for (const k of ["types", "import", "default", "require"] as const) {
      const v = o[k];
      const nested = pickStringFromExportEntry(v);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function exportSubpathKey(subpath: string): string {
  return subpath.length > 0 ? `./${subpath}` : ".";
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    const st = await FS.stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

/** 将 exports / types 指向的路径解析为 workspace 相对路径（文件须存在） */
async function resolvePackageEntryFile(
  workspaceRoot: string,
  rootRel: string,
  pkg: Readonly<Record<string, unknown>>,
  subpath: string,
  existenceCache: Map<string, boolean>,
): Promise<string | null> {
  const pkgRootAbs = normalize(join(workspaceRoot, rootRel));
  const subKey = exportSubpathKey(subpath);
  const exportsField = pkg.exports;

  const tryRel = async (relFromPkgRoot: string): Promise<string | null> => {
    const cleaned = relFromPkgRoot.replace(/^\.\//, "");
    const abs = normalize(join(pkgRootAbs, cleaned));
    const rel = toPosixRel(workspaceRoot, abs);
    if (!rel) {
      return null;
    }
    let ok = existenceCache.get(rel);
    if (ok === undefined) {
      ok = await pathExists(abs);
      existenceCache.set(rel, ok);
    }
    return ok ? rel : null;
  };

  if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    const ex = exportsField as Record<string, unknown>;
    const entry = ex[subKey];
    if (entry) {
      const picked = pickStringFromExportEntry(entry);
      if (picked) {
        const hit = await tryRel(picked);
        if (hit) {
          return hit;
        }
      }
    }
  }

  if (subpath.length === 0) {
    const types = pkg.types;
    if (typeof types === "string") {
      const hit = await tryRel(types);
      if (hit) {
        return hit;
      }
    }
    const main = pkg.main;
    if (typeof main === "string" && !main.includes("dist/") && !main.includes("dist\\")) {
      const hit = await tryRel(main);
      if (hit) {
        return hit;
      }
    }
    for (const guess of ["src/index.ts", "src/index.tsx", "index.ts"]) {
      const hit = await tryRel(guess);
      if (hit) {
        return hit;
      }
    }
    return null;
  }

  const rest = subpath.replace(/^\/+/, "");
  const candidates = [
    `src/${rest}.ts`,
    `src/${rest}.tsx`,
    `src/${rest}/index.ts`,
    `src/${rest}/index.tsx`,
    `${rest}.ts`,
    `${rest}.tsx`,
  ];
  for (const c of candidates) {
    const hit = await tryRel(c);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/**
 * 扫描 `apps/*`、`packages/*` 及根下 `scripts` 目录，读取各包 `package.json` 的 `name`。
 */
export async function loadWorkspacePackageIndex(
  workspaceRoot: string,
): Promise<WorkspacePackageIndex> {
  const map = new Map<string, { rootRel: string; pkg: Readonly<Record<string, unknown>> }>();
  const rootsToScan: string[] = [];

  async function pushChildDirs(baseRel: string): Promise<void> {
    const abs = join(workspaceRoot, baseRel);
    let entries: Dirent[];
    try {
      entries = (await FS.readdir(abs, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) {
        continue;
      }
      rootsToScan.push(`${baseRel}/${String(ent.name)}`.replace(/\\/g, "/"));
    }
  }

  await pushChildDirs("apps");
  await pushChildDirs("packages");
  const scriptsPkg = join(workspaceRoot, "scripts", "package.json");
  try {
    await FS.access(scriptsPkg);
    rootsToScan.push("scripts");
  } catch {
    // no scripts package
  }

  for (const rootRel of rootsToScan) {
    const pkgPath = join(workspaceRoot, rootRel, "package.json");
    let raw: string;
    try {
      raw = await FS.readFile(pkgPath, "utf-8");
    } catch {
      continue;
    }
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const name = pkg.name;
    if (typeof name !== "string" || name.length === 0) {
      continue;
    }
    if (!map.has(name)) {
      map.set(name, { rootRel, pkg });
    }
  }

  return map;
}

/**
 * 将裸 `from "pkg"` / `import("pkg")` 解析为工作区内源码相对路径；外部依赖返回 null。
 */
export async function resolveBareSpecifierToWorkspaceRel(
  spec: string,
  workspaceRoot: string,
  index: WorkspacePackageIndex,
  existenceCache: Map<string, boolean>,
): Promise<string | null> {
  const parsed = parseBareModuleSpecifier(spec);
  if (!parsed) {
    return null;
  }
  const entry = index.get(parsed.name);
  if (!entry) {
    return null;
  }
  return resolvePackageEntryFile(
    workspaceRoot,
    entry.rootRel,
    entry.pkg,
    parsed.subpath,
    existenceCache,
  );
}
