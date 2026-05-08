import { ensureLocalApi } from "~/localApi";
import { applyProvidersUpdated } from "~/rpc/serverState";

export type ClaudeAgentModelListRefreshOutcome = { ok: true } | { ok: false; error: string };

export async function runClaudeAgentModelListRefresh(): Promise<ClaudeAgentModelListRefreshOutcome> {
  try {
    const result = await ensureLocalApi().server.refreshClaudeAgentModels();
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    applyProvidersUpdated({ providers: result.providers });
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
