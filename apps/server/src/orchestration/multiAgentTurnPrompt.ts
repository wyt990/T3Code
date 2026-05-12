import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

import type { AgentTask } from "./Services/MultiAgentOrchestrator.ts";

export function buildMultiAgentTurnPrompt(input: {
  readonly task: Pick<AgentTask, "id" | "role" | "payload">;
  readonly sharedContext: Record<string, unknown>;
  readonly dependencyResults: ReadonlyArray<{ readonly id: string; readonly result?: unknown }>;
  readonly explicitPrompt?: string | undefined;
}): string {
  const chunks: string[] = [];
  if (input.explicitPrompt !== undefined && input.explicitPrompt !== "") {
    chunks.push(input.explicitPrompt);
  } else {
    const p = input.task.payload as { title?: string; description?: string } | undefined;
    chunks.push(`[Multi-agent task]\nTask id: ${input.task.id}\nRole: ${input.task.role}\n\n`);
    if (p?.title) {
      chunks.push(`Title:\n${p.title}\n\n`);
    }
    if (p?.description) {
      chunks.push(`Description:\n${p.description}\n\n`);
    }
  }
  if (Object.keys(input.sharedContext).length > 0) {
    chunks.push(`Shared context (JSON):\n${JSON.stringify(input.sharedContext, null, 2)}\n\n`);
  }
  if (input.dependencyResults.length > 0) {
    chunks.push(`Outputs from dependency tasks:\n\n`);
    for (const d of input.dependencyResults) {
      const body = typeof d.result === "string" ? d.result : JSON.stringify(d.result, null, 2);
      chunks.push(`--- ${d.id} ---\n${body}\n\n`);
    }
  }
  let text = chunks.join("");
  const max = PROVIDER_SEND_TURN_MAX_INPUT_CHARS;
  if (text.length > max) {
    text = `${text.slice(0, max - 120)}\n\n...[truncated]`;
  }
  return text;
}
