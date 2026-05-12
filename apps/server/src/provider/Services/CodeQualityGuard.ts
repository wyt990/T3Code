import { Context, Effect, Layer } from "effect";
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

export interface CodeQualityGuard {
  readonly learnProjectStyle: (
    projectId: string,
    files: string[],
  ) => Effect.Effect<ProjectStyleProfile, never, never>;
  readonly checkCodeQuality: (params: {
    code: string;
    filePath: string;
    profile: ProjectStyleProfile;
  }) => Effect.Effect<CodeQualityCheckResult, never, never>;
  readonly detectTechDebt: (projectId: string) => Effect.Effect<TechDebtItem[], never, never>;
  readonly validateBestPractices: (params: {
    code: string;
    checklist: BestPracticeChecklist;
  }) => Effect.Effect<{ passed: boolean; violations: string[] }, never, never>;
  readonly enhanceGeneration: (
    request: CodeGenerationRequest,
    profile: ProjectStyleProfile,
  ) => Effect.Effect<CodeGenerationResult, never, never>;
  /** 已学习档案优先，否则返回内置默认规则（不落库）。 */
  readonly resolveStyleProfile: (
    projectId: string,
  ) => Effect.Effect<ProjectStyleProfile, never, never>;
}

export const CodeQualityGuard = Context.Service<CodeQualityGuard>(
  "@t3tools/server/provider/CodeQualityGuard",
);
