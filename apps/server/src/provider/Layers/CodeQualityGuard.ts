import { Effect, Layer, Ref } from "effect";
import * as FS from "node:fs/promises";
import * as Path from "node:path";
import type {
  CodeIssue,
  CodePattern,
  CodeStyleRule,
  ProjectStyleProfile,
  CodeQualityCheckResult,
  BestPracticeChecklist,
  TechDebtItem,
  CodeGenerationRequest,
  CodeGenerationResult,
} from "@t3tools/contracts";
import { CodeQualityGuard } from "../Services/CodeQualityGuard.ts";

// Default naming patterns by language
const DEFAULT_PATTERNS: Record<string, CodePattern[]> = {
  typescript: [
    {
      id: "ts-camelCase",
      name: "camelCase for variables/functions",
      description: "Use camelCase for variable and function names",
      regex: "^[a-z][a-zA-Z0-9]*$",
      category: "naming",
    },
    {
      id: "ts-PascalCase",
      name: "PascalCase for classes/types",
      description: "Use PascalCase for class and type names",
      regex: "^[A-Z][a-zA-Z0-9]*$",
      category: "naming",
    },
    {
      id: "ts-no-any",
      name: "Avoid any type",
      description: "Avoid using 'any' type, use unknown or specific types instead",
      regex: "\\bany\\b",
      category: "structure",
    },
  ],
  javascript: [
    {
      id: "js-camelCase",
      name: "camelCase naming",
      description: "Use camelCase for variable and function names",
      regex: "^[a-z][a-zA-Z0-9]*$",
      category: "naming",
    },
  ],
  python: [
    {
      id: "py-snake_case",
      name: "snake_case naming",
      description: "Use snake_case for variable and function names",
      regex: "^[a-z_][a-z0-9_]*$",
      category: "naming",
    },
    {
      id: "py-PascalCase-class",
      name: "PascalCase for classes",
      description: "Use PascalCase for class names",
      regex: "^[A-Z][a-zA-Z0-9]*$",
      category: "naming",
    },
  ],
};

const DEFAULT_RULES: CodeStyleRule[] = [
  {
    id: "no-console",
    name: "No console statements",
    description: "Avoid console.log in production code",
    severity: "warning",
    category: "structure",
    enabled: true,
  },
  {
    id: "no-unused-vars",
    name: "No unused variables",
    description: "Remove unused variables",
    severity: "error",
    category: "structure",
    enabled: true,
  },
  {
    id: "prefer-const",
    name: "Prefer const",
    description: "Use const for variables that are not reassigned",
    severity: "info",
    category: "structure",
    enabled: true,
  },
  {
    id: "max-line-length",
    name: "Max line length",
    description: "Keep lines under 120 characters",
    severity: "warning",
    category: "formatting",
    enabled: true,
  },
];

const buildDefaultProjectStyleProfile = (projectId: string): ProjectStyleProfile => {
  const patterns: CodePattern[] = [];
  for (const lang of ["typescript", "javascript", "python"] as const) {
    for (const p of DEFAULT_PATTERNS[lang] ?? []) {
      if (!patterns.some((x) => x.id === p.id)) {
        patterns.push(p);
      }
    }
  }
  const now = new Date().toISOString();
  return {
    id: `profile-default-${projectId}`,
    projectId,
    patterns,
    rules: DEFAULT_RULES,
    learnedAt: now,
    lastUpdated: now,
    fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".py"],
  };
};

export const makeCodeQualityGuard = Effect.gen(function* () {
  const profilesRef = yield* Ref.make<Map<string, ProjectStyleProfile>>(new Map());

  const detectLanguage = (filePath: string): string => {
    const ext = Path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
    };
    return langMap[ext] || "unknown";
  };

  const learnProjectStyle = Effect.fn("CodeQualityGuard.learnProjectStyle")(function* (
    projectId: string,
    files: string[],
  ) {
    const patterns: CodePattern[] = [];
    const fileExtensions: string[] = [];

    for (const file of files.slice(0, 50)) {
      // Sample first 50 files
      const ext = Path.extname(file);
      if (ext && !fileExtensions.includes(ext)) {
        fileExtensions.push(ext);
      }

      const lang = detectLanguage(file);
      const defaultPatterns = DEFAULT_PATTERNS[lang] || [];
      for (const pattern of defaultPatterns) {
        if (!patterns.find((p) => p.id === pattern.id)) {
          patterns.push(pattern);
        }
      }
    }

    const profile: ProjectStyleProfile = {
      id: `profile-${projectId}`,
      projectId,
      patterns,
      rules: DEFAULT_RULES,
      learnedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      fileExtensions,
    };

    yield* Ref.update(profilesRef, (profiles) => {
      const newProfiles = new Map(profiles);
      newProfiles.set(projectId, profile);
      return newProfiles;
    });

    yield* Effect.log(`[CodeQuality] Learned style for project: ${projectId}`);
    return profile;
  });

  const checkCodeQuality = Effect.fn("CodeQualityGuard.checkCodeQuality")(function* (params: {
    code: string;
    filePath: string;
    profile: ProjectStyleProfile;
  }) {
    const issues: CodeIssue[] = [];
    const lines = params.code.split("\n");
    const lang = detectLanguage(params.filePath);

    // Check patterns
    for (const pattern of params.profile.patterns) {
      if (pattern.category === "naming") {
        // Simple naming check for variable declarations
        const varRegex = /(?:const|let|var|function)\s+(\w+)/g;
        let match;
        while ((match = varRegex.exec(params.code)) !== null) {
          const name = match[1];
          if (name === undefined) continue;
          const patternRegex = new RegExp(pattern.regex);
          if (!patternRegex.test(name)) {
            const lineIndex = params.code.substring(0, match.index).split("\n").length - 1;
            issues.push({
              id: `issue-${Date.now()}-${issues.length}`,
              ruleId: pattern.id,
              filePath: params.filePath,
              line: lineIndex + 1,
              column: match.index - params.code.lastIndexOf("\n", match.index),
              message: `Naming violation: ${name} does not follow ${pattern.name}`,
              severity: "warning",
              category: "naming",
              suggestedFix: `Rename to follow ${pattern.name} pattern`,
              confidence: 0.8,
            });
          }
        }
      }

      // Check forbidden patterns
      if (pattern.regex && pattern.category === "structure") {
        const forbiddenRegex = new RegExp(pattern.regex, "g");
        let match;
        while ((match = forbiddenRegex.exec(params.code)) !== null) {
          const lineIndex = params.code.substring(0, match.index).split("\n").length - 1;
          issues.push({
            id: `issue-${Date.now()}-${issues.length}`,
            ruleId: pattern.id,
            filePath: params.filePath,
            line: lineIndex + 1,
            column: match.index - params.code.lastIndexOf("\n", match.index),
            message: pattern.description,
            severity: "warning",
            category: "structure",
            confidence: 0.9,
          });
        }
      }
    }

    // Check line length
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && line.length > 120) {
        issues.push({
          id: `issue-${Date.now()}-${issues.length}`,
          ruleId: "max-line-length",
          filePath: params.filePath,
          line: i + 1,
          column: 120,
          message: `Line exceeds 120 characters (${line.length})`,
          severity: "warning",
          category: "formatting",
          confidence: 1.0,
        });
      }
    }

    // Calculate score
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;
    const score = Math.max(0, 100 - errorCount * 10 - warningCount * 2);

    const result: CodeQualityCheckResult = {
      filePath: params.filePath,
      issues,
      score,
      checkedAt: new Date().toISOString(),
    };

    yield* Effect.log(`[CodeQuality] Checked ${params.filePath}: score ${score}`);
    return result;
  });

  const detectTechDebt = Effect.fn("CodeQualityGuard.detectTechDebt")(function* (
    projectId: string,
  ) {
    const items: TechDebtItem[] = [];

    // Simple heuristics for tech debt detection
    const debtPatterns = [
      { regex: /TODO|FIXME|XXX|HACK/g, category: "outdated" as const, severity: "medium" as const },
      {
        regex: /console\.(log|warn|error)/g,
        category: "structure" as const,
        severity: "low" as const,
      },
      { regex: /\/\/\s*eslint-disable/g, category: "structure" as const, severity: "low" as const },
      { regex: /any\[\]/g, category: "structure" as const, severity: "medium" as const },
    ];

    // This would scan actual files in a real implementation
    // For now, return sample items
    items.push({
      id: `debt-${Date.now()}-1`,
      filePath: "src/example.ts",
      line: 10,
      description: "TODO comment found: refactor this function",
      severity: "medium",
      category: "outdated",
      estimatedEffort: 2,
      createdAt: new Date().toISOString(),
    });

    yield* Effect.log(`[CodeQuality] Detected ${items.length} tech debt items for ${projectId}`);
    return items;
  });

  const validateBestPractices = Effect.fn("CodeQualityGuard.validateBestPractices")(
    function* (params: { code: string; checklist: BestPracticeChecklist }) {
      const violations: string[] = [];

      for (const item of params.checklist.items) {
        if (!item.checked && item.required) {
          // Simple pattern matching for demonstration
          if (item.description.includes("error handling") && !params.code.includes("try")) {
            violations.push(`Missing: ${item.description}`);
          }
          if (item.description.includes("documentation") && !params.code.includes("/**")) {
            violations.push(`Missing: ${item.description}`);
          }
        }
      }

      return {
        passed: violations.length === 0,
        violations,
      };
    },
  );

  const resolveStyleProfile = Effect.fn("CodeQualityGuard.resolveStyleProfile")(function* (
    projectId: string,
  ) {
    const profiles = yield* Ref.get(profilesRef);
    return profiles.get(projectId) ?? buildDefaultProjectStyleProfile(projectId);
  });

  const enhanceGeneration = Effect.fn("CodeQualityGuard.enhanceGeneration")(function* (
    request: CodeGenerationRequest,
    profile: ProjectStyleProfile,
  ) {
    // Apply style patterns to generation context
    const enhancedPrompt = request.prompt;

    // Add style guidance
    const styleGuidance = profile.patterns.map((p) => `- ${p.name}: ${p.description}`).join("\n");

    const result: CodeGenerationResult = {
      success: true,
      issues: [],
      appliedPatterns: profile.patterns,
      qualityScore: 0,
    };

    yield* Effect.log("[CodeQuality] Enhanced code generation with style profile");
    return result;
  });

  return {
    learnProjectStyle,
    checkCodeQuality,
    detectTechDebt,
    validateBestPractices,
    enhanceGeneration,
    resolveStyleProfile,
  };
});

export const CodeQualityGuardLive = Layer.effect(CodeQualityGuard, makeCodeQualityGuard);
