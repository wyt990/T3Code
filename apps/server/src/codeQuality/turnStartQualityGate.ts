import { Effect } from "effect";
import type { CodeQualityTurnGateDispatchSummary, OrchestrationCommand } from "@t3tools/contracts";
import { OrchestrationDispatchCommandError } from "@t3tools/contracts";

import type { CodeQualityGuard } from "../provider/Services/CodeQualityGuard.ts";
import { extractMarkdownCodeBlocks } from "./extractMarkdownCodeBlocks.ts";

const DEFAULT_MIN_SCORE = 70;
const MAX_SNIPPETS = 8;

function fenceLangToVirtualPath(lang: string, index: number): string {
  const l = lang.toLowerCase();
  if (l.includes("tsx") || l === "typescriptreact") {
    return `turn-gate-snippet-${index}.tsx`;
  }
  if (l.includes("ts") || l === "typescript") {
    return `turn-gate-snippet-${index}.ts`;
  }
  if (l.includes("jsx")) {
    return `turn-gate-snippet-${index}.jsx`;
  }
  if (l.includes("js") || l === "javascript") {
    return `turn-gate-snippet-${index}.js`;
  }
  if (l.includes("py")) {
    return `turn-gate-snippet-${index}.py`;
  }
  return `turn-gate-snippet-${index}.txt`;
}

export const runTurnStartCodeQualityGate = (input: {
  readonly command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>;
  readonly projectId: string;
  readonly guard: CodeQualityGuard;
}): Effect.Effect<CodeQualityTurnGateDispatchSummary, OrchestrationDispatchCommandError> =>
  Effect.gen(function* () {
    const gate = input.command.codeQualityGate;
    if (!gate || gate.mode === "off") {
      return {
        outcome: "skipped_mode_off",
        checkedSnippets: 0,
        messages: [],
      } as CodeQualityTurnGateDispatchSummary;
    }

    const minScore = gate.minScorePerSnippet ?? DEFAULT_MIN_SCORE;
    const blocks = extractMarkdownCodeBlocks(input.command.message.text);
    if (blocks.length === 0) {
      return {
        outcome: "skipped_no_code_blocks",
        checkedSnippets: 0,
        messages: [],
      } as CodeQualityTurnGateDispatchSummary;
    }

    const profile = yield* input.guard.resolveStyleProfile(input.projectId);
    const toCheck = blocks.slice(0, MAX_SNIPPETS);
    const scores: number[] = [];
    const messages: string[] = [];

    for (let i = 0; i < toCheck.length; i++) {
      const block = toCheck[i]!;
      const filePath = fenceLangToVirtualPath(block.lang, i);
      const res = yield* input.guard.checkCodeQuality({
        code: block.body,
        filePath,
        profile,
      });
      scores.push(res.score);
      if (res.score < minScore) {
        const preview = res.issues
          .slice(0, 3)
          .map((iss) => `${filePath}:${iss.line} ${iss.message}`)
          .join("; ");
        messages.push(
          preview.length > 0
            ? `得分 ${res.score}（低于 ${minScore}）：${preview}`
            : `得分 ${res.score} 低于阈值 ${minScore}`,
        );
      }
    }

    const lowestScore = Math.min(...scores);
    const failed = scores.some((s) => s < minScore);

    if (failed && gate.mode === "block") {
      const detail =
        messages.length > 0 ? messages.join(" | ") : `最低分 ${lowestScore} 低于阈值 ${minScore}`;
      return yield* new OrchestrationDispatchCommandError({
        message: `代码质量闸门拦截：${detail}`,
      });
    }

    return {
      outcome: failed ? "warned" : "passed",
      checkedSnippets: toCheck.length,
      lowestScore,
      messages: failed ? messages : [],
    } as CodeQualityTurnGateDispatchSummary;
  });
