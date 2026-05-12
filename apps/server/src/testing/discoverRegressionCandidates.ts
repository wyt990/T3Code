import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

import type { RegressionTestSelection } from "@t3tools/contracts";

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-electron",
  ".turbo",
  "coverage",
  "out",
  "build",
  ".next",
  ".cache",
]);

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/i;

function vitestStemFromTestFile(testPath: string): string {
  const base = nodePath.basename(testPath);
  const m = /^(.+?)\.(test|spec)\.[cm]?[jt]sx?$/i.exec(base);
  return m?.[1] !== undefined ? m[1]! : base.replace(/\.[cm]?[jt]sx?$/i, "");
}

function sourceStem(changedPath: string): string {
  const base = nodePath.basename(changedPath.replace(/\\/g, "/"));
  return base.replace(/\.[cm]?[jt]sx?$/i, "");
}

/**
 * Collects Vitest-style test paths (posix relative to `workspaceRoot`).
 */
export function discoverTestFilePaths(workspaceRoot: string, maxCollect: number): string[] {
  const absRoot = nodePath.resolve(workspaceRoot);
  const out: string[] = [];
  let visits = 0;
  const maxVisits = 8000;

  const walk = (dir: string): void => {
    if (out.length >= maxCollect || visits >= maxVisits) {
      return;
    }
    visits += 1;
    let entries: nodeFs.Dirent[];
    try {
      entries = nodeFs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= maxCollect || visits >= maxVisits) {
        return;
      }
      const name = ent.name;
      if (name === "." || name === "..") {
        continue;
      }
      if (SKIP_DIR.has(name)) {
        continue;
      }
      const full = nodePath.join(dir, name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && TEST_FILE_RE.test(name)) {
        const rel = nodePath.relative(absRoot, full).split(nodePath.sep).join("/");
        if (!rel.startsWith("..") && rel.length > 0) {
          out.push(rel);
        }
      }
    }
  };

  try {
    walk(absRoot);
  } catch {
    return out;
  }
  return out;
}

function matchesChange(testPath: string, changedNorm: string, sourceBase: string): boolean {
  const tnorm = testPath.replace(/\\/g, "/").toLowerCase();
  const cnorm = changedNorm.replace(/\\/g, "/").toLowerCase();
  const testStem = vitestStemFromTestFile(tnorm).toLowerCase();
  const base = sourceBase.toLowerCase();
  if (testStem === base) {
    return true;
  }
  if (testStem.startsWith(`${base}.`) || base.startsWith(`${testStem}.`)) {
    return true;
  }
  if (tnorm.includes(`/${base}.`) || tnorm.includes(`/${base}/`)) {
    return true;
  }
  const dChanged = nodePath.posix.dirname(cnorm);
  const dTest = nodePath.posix.dirname(tnorm);
  if (dChanged === dTest && (tnorm.includes(base) || testStem.includes(base))) {
    return true;
  }
  return false;
}

export function matchRegressionTestPaths(
  changedFiles: readonly string[],
  testPaths: readonly string[],
): string[] {
  const selected = new Set<string>();
  for (const cf of changedFiles) {
    const cnorm = cf.trim().replace(/\\/g, "/");
    if (cnorm.length === 0) {
      continue;
    }
    const stem = sourceStem(cnorm);
    if (stem.length === 0) {
      continue;
    }
    for (const tp of testPaths) {
      if (matchesChange(tp, cnorm, stem)) {
        selected.add(tp);
      }
    }
  }
  return [...selected].slice(0, 48);
}

export function buildRegressionSelection(
  changedFiles: readonly string[],
  workspaceRoot: string | undefined,
): RegressionTestSelection {
  const trimmed = workspaceRoot?.trim();
  const files = [...changedFiles].map((f) => f.trim()).filter((f) => f.length > 0);

  if (trimmed === undefined || trimmed.length === 0) {
    return {
      changedFiles: files,
      affectedModules: [...files],
      selectedTests: [],
      reason: "未提供 workspaceRoot，无法扫描工作区。请在已打开项目会话的工作台中操作。",
      confidence: 0.28,
    };
  }

  const tests = discoverTestFilePaths(trimmed, 500);
  const selected = matchRegressionTestPaths(files, tests);
  const confidence =
    selected.length === 0 ? 0.32 : Math.min(0.92, 0.48 + Math.min(selected.length, 10) * 0.04);

  return {
    changedFiles: files,
    affectedModules: [...files],
    selectedTests: selected,
    reason:
      selected.length > 0
        ? `在工作区扫描到 ${tests.length} 个测试文件，按变更路径启发式匹配 ${selected.length} 个（可在「运行选中」中执行 vitest）。`
        : `工作区内发现 ${tests.length} 个测试文件，但与当前变更列表未匹配到明显对应项；请检查路径是否为相对仓库根的写法。`,
    confidence,
  };
}
