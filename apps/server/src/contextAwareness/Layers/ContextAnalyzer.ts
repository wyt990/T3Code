import { Effect, Layer, Ref } from "effect";
import type { Dirent } from "node:fs";
import * as FS from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

import {
  ContextAnalyzer,
  type ContextAnalyzerShape,
  ContextPoolNotFoundError,
} from "../Services/ContextAnalyzer.ts";
import {
  loadWorkspacePackageIndex,
  resolveBareSpecifierToWorkspaceRel,
  type WorkspacePackageIndex,
} from "../workspacePackageResolve.ts";
import { runProcess } from "../../processRunner.ts";
import type {
  ContextAnalysisRequest,
  ContextPool,
  ContextEntry,
  ContextSourceType,
  SmartSuggestion,
  DependencyGraph,
  DependencyEdge,
  DependencyNode,
  ChangeImpact,
  ImpactLevel,
  ThreadContext,
  ContextAnalysisResponse,
  ProjectId,
} from "@t3tools/contracts";

// -----------------------------------------------------------------------------
// Context Extraction Helpers
// -----------------------------------------------------------------------------

async function findGitModifiedFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const gitDir = join(workspaceRoot, ".git");
    const stat = await FS.stat(gitDir).catch(() => null);
    if (!stat?.isDirectory()) {
      return [];
    }
    const result = await runProcess("git", ["status", "--porcelain"], {
      cwd: workspaceRoot,
      timeoutMs: 30_000,
      allowNonZeroExit: true,
    });
    if (result.code !== 0) {
      return [];
    }
    const paths: string[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line.length < 4) continue;
      const raw = line.slice(3).trim();
      if (!raw) continue;
      const pathPart = raw.includes(" -> ") ? (raw.split(" -> ").pop() ?? raw) : raw;
      const cleaned = pathPart.replace(/^"|"$/g, "").replace(/\\/g, "/");
      if (cleaned.length > 0) {
        paths.push(cleaned);
      }
    }
    return [...new Set(paths)].slice(0, 500);
  } catch {
    return [];
  }
}

async function findTodoComments(
  workspaceRoot: string,
): Promise<Array<{ path: string; line: number; content: string; kind: "todo" | "fixme" }>> {
  const results: Array<{ path: string; line: number; content: string; kind: "todo" | "fixme" }> =
    [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".turbo", "coverage", ".next"]);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || results.length >= 200) return;
    let entries: Dirent[];
    try {
      entries = (await FS.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const ent of entries) {
      const base = String(ent.name);
      if (skip.has(base)) continue;
      const full = join(dir, base);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|css|md)$/i.test(base)) {
        try {
          const text = await FS.readFile(full, "utf-8");
          const lines = text.split("\n");
          const rel = relative(workspaceRoot, full).replace(/\\/g, "/");
          lines.forEach((lineText, i) => {
            const isFixme = /\bFIXME\b/i.test(lineText);
            const isTodo = /\bTODO\b/i.test(lineText);
            if (isFixme || isTodo) {
              results.push({
                path: rel,
                line: i + 1,
                content: lineText.trim().slice(0, 240),
                kind: isFixme ? "fixme" : "todo",
              });
            }
          });
        } catch {
          // skip unreadable file
        }
      }
    }
  }

  await walk(workspaceRoot, 0);
  return results;
}

async function findBranchUpstreamDeltaFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const gitDir = join(workspaceRoot, ".git");
    const stat = await FS.stat(gitDir).catch(() => null);
    if (!stat?.isDirectory()) {
      return [];
    }
    const upstreamRef = await runProcess("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
      cwd: workspaceRoot,
      timeoutMs: 12_000,
      allowNonZeroExit: true,
    });
    if (upstreamRef.code !== 0 || !upstreamRef.stdout.trim()) {
      return [];
    }
    const upstream = upstreamRef.stdout.trim();
    const diff = await runProcess("git", ["diff", "--name-only", `${upstream}...HEAD`], {
      cwd: workspaceRoot,
      timeoutMs: 45_000,
      allowNonZeroExit: true,
    });
    if (diff.code !== 0) {
      return [];
    }
    return [
      ...new Set(
        diff.stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      ),
    ].slice(0, 300);
  } catch {
    return [];
  }
}

async function identifyCoreModules(workspaceRoot: string): Promise<string[]> {
  const corePatterns = ["src/", "lib/", "apps/", "packages/"];
  const modules: string[] = [];
  for (const pattern of corePatterns) {
    const dir = join(workspaceRoot, pattern);
    try {
      const stat = await FS.stat(dir);
      if (stat.isDirectory()) {
        modules.push(pattern);
      }
    } catch {
      // Directory doesn't exist
    }
  }
  return modules;
}

async function collectSourceFiles(workspaceRoot: string, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".turbo", "coverage", ".next"]);

  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= maxFiles || depth > 8) return;
    let entries: Dirent[];
    try {
      entries = (await FS.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const ent of entries) {
      const base = String(ent.name);
      if (skip.has(base)) continue;
      const full = join(dir, base);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(base)) {
        out.push(full);
      }
    }
  }

  await walk(workspaceRoot, 0);
  return out.slice(0, maxFiles);
}

function resolveWorkspaceRelativeImport(
  fileAbs: string,
  workspaceRoot: string,
  spec: string,
): string | null {
  if (!spec.startsWith(".")) {
    return null;
  }
  try {
    const resolved = normalize(join(dirname(fileAbs), spec));
    const rel = relative(workspaceRoot, resolved).replace(/\\/g, "/");
    if (!rel.startsWith("..")) {
      return rel;
    }
  } catch {
    return null;
  }
  return null;
}

async function extractResolvedImportTargets(
  fileAbs: string,
  workspaceRoot: string,
  source: string,
  index: WorkspacePackageIndex,
  existenceCache: Map<string, boolean>,
): Promise<string[]> {
  const imports: string[] = [];
  const fromImport = /\bfrom\s+["']([^"']+)["']/g;
  const dynImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [fromImport, dynImport]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      if (spec.startsWith(".")) {
        const rel = resolveWorkspaceRelativeImport(fileAbs, workspaceRoot, spec);
        if (rel) {
          imports.push(rel);
        }
      } else {
        const rel = await resolveBareSpecifierToWorkspaceRel(
          spec,
          workspaceRoot,
          index,
          existenceCache,
        );
        if (rel) {
          imports.push(rel);
        }
      }
    }
  }
  return [...new Set(imports)];
}

/** `export * from './x'` / `export { a } from 'pkg'` 等 re-export 目标（含工作区包名） */
async function extractResolvedReexportTargets(
  fileAbs: string,
  workspaceRoot: string,
  source: string,
  index: WorkspacePackageIndex,
  existenceCache: Map<string, boolean>,
): Promise<string[]> {
  const targets: string[] = [];
  const patterns = [
    /export\s+\*\s+from\s+["']([^"']+)["']/g,
    /export\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/g,
    /export\s+\*\s+as\s+\w+\s+from\s+["']([^"']+)["']/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      if (spec.startsWith(".")) {
        const rel = resolveWorkspaceRelativeImport(fileAbs, workspaceRoot, spec);
        if (rel) {
          targets.push(rel);
        }
      } else {
        const rel = await resolveBareSpecifierToWorkspaceRel(
          spec,
          workspaceRoot,
          index,
          existenceCache,
        );
        if (rel) {
          targets.push(rel);
        }
      }
    }
  }
  return [...new Set(targets)];
}

async function buildImportDependencyGraph(
  workspaceRoot: string,
  maxFiles: number,
): Promise<DependencyGraph> {
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const cap = Math.min(Math.max(maxFiles, 20), 400);
  const files = await collectSourceFiles(workspaceRoot, cap);
  const pkgIndex = await loadWorkspacePackageIndex(workspaceRoot);
  const existenceCache = new Map<string, boolean>();

  for (const abs of files) {
    let text: string;
    try {
      text = await FS.readFile(abs, "utf-8");
    } catch {
      continue;
    }
    const rel = relative(workspaceRoot, abs).replace(/\\/g, "/");
    const imps = await extractResolvedImportTargets(
      abs,
      workspaceRoot,
      text,
      pkgIndex,
      existenceCache,
    );
    const reExports = await extractResolvedReexportTargets(
      abs,
      workspaceRoot,
      text,
      pkgIndex,
      existenceCache,
    );
    const impsSet = new Set(imps);
    nodes.push({
      id: rel,
      path: rel,
      type: "file",
      imports: [...imps, ...reExports.filter((t) => !impsSet.has(t))],
      exports: reExports,
    });
    for (const to of imps) {
      edges.push({ from: rel, to, type: "import" });
    }
    for (const to of reExports) {
      edges.push({
        from: rel,
        to,
        type: impsSet.has(to) ? "import" : "reference",
      });
    }
  }

  return {
    nodes,
    edges,
    lastUpdated: new Date().toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Context Analyzer Live Implementation
// -----------------------------------------------------------------------------

export const makeContextAnalyzer = Effect.gen(function* () {
  const contextPoolCache = yield* Ref.make<Map<string, ContextPool>>(new Map());

  const analyzeContext: ContextAnalyzerShape["analyzeContext"] = Effect.fn(
    "ContextAnalyzer.analyzeContext",
  )(function* (request: ContextAnalysisRequest) {
    const entries: ContextEntry[] = [];

    if (request.options?.includeCoreModules ?? true) {
      const coreModules = yield* Effect.promise(() => identifyCoreModules(request.workspaceRoot));
      for (const module of coreModules) {
        entries.push({
          id: `core-${module}`,
          source: {
            type: "core-module" as ContextSourceType,
            path: module,
          },
          priority: "high",
          relevanceScore: 0.8,
          lastUpdated: new Date().toISOString(),
        });
      }
    }

    if (request.options?.includeGitDiff ?? true) {
      const modifiedFiles = yield* Effect.promise(() =>
        findGitModifiedFiles(request.workspaceRoot),
      );
      for (const file of modifiedFiles) {
        entries.push({
          id: `git-${file}`,
          source: {
            type: "git-diff" as ContextSourceType,
            path: file,
          },
          priority: "critical",
          relevanceScore: 0.95,
          lastUpdated: new Date().toISOString(),
        });
      }
    }

    if (request.options?.includeTodoComments ?? true) {
      const todos = yield* Effect.promise(() => findTodoComments(request.workspaceRoot));
      for (const todo of todos) {
        const isFixme = todo.kind === "fixme";
        entries.push({
          id: `${isFixme ? "fixme" : "todo"}-${todo.path}:${todo.line}`,
          source: {
            type: (isFixme ? "fixme-comment" : "todo-comment") as ContextSourceType,
            path: todo.path,
            content: todo.content,
          },
          priority: isFixme ? "high" : "medium",
          relevanceScore: isFixme ? 0.82 : 0.7,
          lastUpdated: new Date().toISOString(),
        });
      }
    }

    if (request.options?.includeBranchDelta !== false) {
      const seenPaths = new Set(entries.map((e) => e.source.path));
      const upstreamFiles = yield* Effect.promise(() =>
        findBranchUpstreamDeltaFiles(request.workspaceRoot),
      );
      for (const file of upstreamFiles) {
        if (seenPaths.has(file)) {
          continue;
        }
        seenPaths.add(file);
        entries.push({
          id: `git-upstream-${file}`,
          source: {
            type: "git-diff" as ContextSourceType,
            path: file,
            metadata: { branchDelta: "upstream" },
          },
          priority: "high",
          relevanceScore: 0.88,
          lastUpdated: new Date().toISOString(),
        });
      }
    }

    const maxDep =
      request.options?.maxDependencyScanFiles !== undefined
        ? request.options.maxDependencyScanFiles
        : 160;
    const dependencyGraph =
      (request.options?.includeCoreModules ?? true)
        ? yield* Effect.promise(() => buildImportDependencyGraph(request.workspaceRoot, maxDep))
        : undefined;

    const suggestions: SmartSuggestion[] = [];

    const todoEntries = entries.filter((e) => e.source.type === "todo-comment");
    const fixmeEntries = entries.filter((e) => e.source.type === "fixme-comment");
    if (todoEntries.length > 0) {
      suggestions.push({
        id: "suggestion-todo-batch",
        type: "todo-batch",
        title: `处理 ${todoEntries.length} 个未完成的 TODO`,
        description: "检测到多个待处理的任务，建议批量处理",
        action: "batch-todo-process",
        context: todoEntries,
        priority: "medium",
      });
    }
    if (fixmeEntries.length > 0) {
      suggestions.push({
        id: "suggestion-fixme-batch",
        type: "refactor-suggestion",
        title: `优先处理 ${fixmeEntries.length} 处 FIXME`,
        description: "FIXME 通常表示已知缺陷或技术债，建议先于普通 TODO 处理",
        action: "batch-fixme-process",
        context: fixmeEntries,
        priority: "high",
      });
    }

    const gitEntries = entries.filter((e) => e.source.type === "git-diff");
    if (gitEntries.length > 0) {
      suggestions.push({
        id: "suggestion-commit",
        type: "commit-prompt",
        title: "生成提交信息",
        description: `检测到 ${gitEntries.length} 个未提交的变更`,
        action: "generate-commit-message",
        context: gitEntries,
        priority: "high",
      });
    }

    const upstreamOnly = entries.filter(
      (e) => e.source.type === "git-diff" && e.source.metadata?.branchDelta === "upstream",
    );
    if (upstreamOnly.length > 0) {
      suggestions.push({
        id: "suggestion-upstream-sync",
        type: "dependency-update",
        title: `与上游分支存在 ${upstreamOnly.length} 个文件差异`,
        description: "合并或变基前可复查这些路径，降低冲突风险",
        action: "review-upstream-delta",
        context: upstreamOnly.slice(0, 40),
        priority: "high",
      });
    }

    const contextPool: ContextPool = {
      projectId: request.projectId,
      entries,
      lastRefreshed: new Date().toISOString(),
    };

    yield* Ref.update(contextPoolCache, (cache) => {
      const next = new Map(cache);
      next.set(String(request.projectId), contextPool);
      return next;
    });

    return {
      contextPool,
      suggestions,
      dependencyGraph,
    } as ContextAnalysisResponse;
  });

  const getContextPool: ContextAnalyzerShape["getContextPool"] = Effect.fn(
    "ContextAnalyzer.getContextPool",
  )(function* (projectId: string) {
    const cache = yield* Ref.get(contextPoolCache);
    const pool = cache.get(projectId);
    if (!pool) {
      return yield* new ContextPoolNotFoundError({ projectId });
    }
    return pool;
  });

  const updateContextPool: ContextAnalyzerShape["updateContextPool"] = Effect.fn(
    "ContextAnalyzer.updateContextPool",
  )(function* (projectId: string, pool: ContextPool) {
    yield* Ref.update(contextPoolCache, (cache) => {
      const newCache = new Map(cache);
      newCache.set(projectId, pool);
      return newCache;
    });
  });

  const buildDependencyGraph: ContextAnalyzerShape["buildDependencyGraph"] = Effect.fn(
    "ContextAnalyzer.buildDependencyGraph",
  )(function* (workspaceRoot: string) {
    return yield* Effect.promise(() => buildImportDependencyGraph(workspaceRoot, 160));
  });

  const analyzeChangeImpact: ContextAnalyzerShape["analyzeChangeImpact"] = Effect.fn(
    "ContextAnalyzer.analyzeChangeImpact",
  )(function* (params: {
    changedFile: string;
    dependencyGraph: DependencyGraph;
    maxReverseImportHops?: number;
  }) {
    const norm = (p: string) => p.trim().replace(/\\/g, "/");
    const target = norm(params.changedFile);
    const maxHops = Math.min(Math.max(params.maxReverseImportHops ?? 2, 1), 6);

    const reverse = new Map<string, Set<string>>();
    for (const edge of params.dependencyGraph.edges) {
      const to = norm(edge.to);
      const from = norm(edge.from);
      let set = reverse.get(to);
      if (!set) {
        set = new Set();
        reverse.set(to, set);
      }
      set.add(from);
    }

    const directSet = reverse.get(target) ?? new Set<string>();
    const direct = [...directSet]
      .filter((p) => p !== target)
      .toSorted((a, b) => a.localeCompare(b));

    const all = new Set<string>(direct);
    let frontier = [...direct];
    for (let hop = 1; hop < maxHops; hop++) {
      const next: string[] = [];
      for (const n of frontier) {
        for (const m of reverse.get(n) ?? []) {
          if (m === target) {
            continue;
          }
          if (!all.has(m)) {
            all.add(m);
            next.push(m);
          }
        }
      }
      frontier = next;
      if (next.length === 0) {
        break;
      }
      if (all.size > 500) {
        break;
      }
    }

    const transitive = [...all]
      .filter((p) => !directSet.has(p))
      .toSorted((a, b) => a.localeCompare(b));
    const totalCount = all.size;

    let impactLevel: ImpactLevel = "none";
    if (totalCount === 0) {
      impactLevel = "low";
    } else if (totalCount <= 3) {
      impactLevel = "medium";
    } else if (totalCount <= 10) {
      impactLevel = "high";
    } else {
      impactLevel = "critical";
    }

    const riskReasons: string[] = [];
    if (totalCount > 5) {
      riskReasons.push("影响范围较大");
    }
    if (transitive.length > 0) {
      riskReasons.push(`含 ${transitive.length} 个传递性 import 方（多跳反向依赖）`);
    }
    if (totalCount === 0) {
      riskReasons.push("依赖图中未找到导入该文件的边（请确认路径与 import 图一致）");
    }

    const sensitiveSegments: ReadonlyArray<{ needle: string; label: string }> = [
      { needle: "packages/contracts", label: "共享契约包" },
      { needle: "apps/server/src/ws.ts", label: "WebSocket / RPC 入口" },
      { needle: "packages/contracts/src/rpc.ts", label: "RPC 方法表" },
      { needle: "orchestration", label: "编排域" },
      { needle: "persistence", label: "持久化层" },
    ];
    for (const { needle, label } of sensitiveSegments) {
      if (target.includes(needle)) {
        riskReasons.push(`变更点位于敏感路径（${label}），协议或数据面风险更高`);
      }
    }
    const sharedHits = [...all].filter((p) => p.includes("packages/shared")).length;
    if (sharedHits >= 3) {
      riskReasons.push(`多个导入方位于 packages/shared（${sharedHits}），属公共依赖面`);
    }

    return {
      changedFile: target,
      affectedFiles: direct,
      transitiveImporters: transitive,
      impactHopDepth: maxHops,
      impactLevel,
      riskReasons,
    } as ChangeImpact;
  });

  const mergeTurnDiffContextEntries: ContextAnalyzerShape["mergeTurnDiffContextEntries"] =
    Effect.fn("ContextAnalyzer.mergeTurnDiffContextEntries")(function* (input: {
      readonly projectId: ProjectId;
      readonly relativePaths: ReadonlyArray<string>;
    }) {
      const key = String(input.projectId);
      const now = new Date().toISOString();
      const paths = [...new Set(input.relativePaths.map((p) => p.trim().replace(/\\/g, "/")))]
        .filter((p) => p.length > 0)
        .slice(0, 120);

      const cache = yield* Ref.get(contextPoolCache);
      const existing = cache.get(key);
      const basePool: ContextPool =
        existing ??
        ({
          projectId: input.projectId,
          entries: [],
          lastRefreshed: now,
        } as ContextPool);

      const withoutSessionTouch = basePool.entries.filter((e) => e.source.type !== "session-touch");

      const touchEntries: ContextEntry[] = paths.map((path) => ({
        id: `session-touch:${path}`,
        source: {
          type: "session-touch",
          path,
          metadata: { origin: "turn-diff" },
        },
        priority: "high",
        relevanceScore: 0.92,
        lastUpdated: now,
      }));

      const nextPool: ContextPool = {
        ...basePool,
        entries: [...withoutSessionTouch, ...touchEntries],
        lastRefreshed: now,
      };

      yield* Ref.update(contextPoolCache, (m) => {
        const n = new Map(m);
        n.set(key, nextPool);
        return n;
      });
    });

  const getSmartSuggestions: ContextAnalyzerShape["getSmartSuggestions"] = Effect.fn(
    "ContextAnalyzer.getSmartSuggestions",
  )(function* (threadContext: ThreadContext) {
    const suggestions: SmartSuggestion[] = [];

    if (threadContext.recentChanges.length > 3) {
      suggestions.push({
        id: "suggestion-review-changes",
        type: "refactor-suggestion",
        title: "审查最近的变更",
        description: `检测到 ${threadContext.recentChanges.length} 个最近的变更`,
        action: "review-recent-changes",
        priority: "medium",
      });
    }

    if (threadContext.activeFiles.length > 5) {
      suggestions.push({
        id: "suggestion-focus",
        type: "refactor-suggestion",
        title: "聚焦核心文件",
        description: "活跃文件较多，建议聚焦核心变更",
        action: "focus-core-files",
        priority: "low",
      });
    }

    const testLike = threadContext.activeFiles.filter((p) =>
      /\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(p),
    );
    if (testLike.length >= 2) {
      suggestions.push({
        id: "suggestion-run-tests",
        type: "test-suggestion",
        title: `关联测试文件 ${testLike.length} 个`,
        description: "可在工作区运行 Vitest 覆盖这些路径，验证回归",
        action: "run-related-tests",
        priority: "medium",
      });
    }

    const contractsTouches = threadContext.activeFiles.filter((p) =>
      p.replace(/\\/g, "/").includes("packages/contracts"),
    );
    if (contractsTouches.length > 0) {
      suggestions.push({
        id: "suggestion-contracts-active",
        type: "refactor-suggestion",
        title: "契约包处于活跃上下文",
        description:
          "检测到 packages/contracts 路径；若修改 Schema/RPC，请同步构建 contracts 并检查 Web/Server 类型引用",
        action: "review-contracts-drift",
        priority: "high",
      });
    }

    return suggestions;
  });

  const refreshContextPool: ContextAnalyzerShape["refreshContextPool"] = Effect.fn(
    "ContextAnalyzer.refreshContextPool",
  )(function* (projectId: string, workspaceRoot: string) {
    const analyzed = yield* analyzeContext({
      projectId: projectId as ProjectId,
      workspaceRoot,
      options: {
        includeGitDiff: true,
        includeTodoComments: true,
        includeCoreModules: true,
        includeBranchDelta: true,
        maxEntries: 500,
        maxDependencyScanFiles: 200,
      },
    });
    return analyzed.contextPool;
  });

  return {
    analyzeContext,
    getContextPool,
    updateContextPool,
    buildDependencyGraph,
    analyzeChangeImpact,
    getSmartSuggestions,
    refreshContextPool,
    mergeTurnDiffContextEntries,
  } satisfies ContextAnalyzerShape;
});

export const ContextAnalyzerLive = Layer.effect(ContextAnalyzer, makeContextAnalyzer);
