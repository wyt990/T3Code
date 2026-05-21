import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { readEnvironmentApi } from "../environmentApi.ts";

export type ConnectionProvidersRefreshOutcome = { ok: true } | { ok: false; error: string };

export async function refreshSshConnectionProviders(input: {
  readonly environmentId: EnvironmentId;
  readonly connectionId: string;
  readonly projectId: ProjectId;
}): Promise<
  | { ok: true; providers: ReadonlyArray<import("@t3tools/contracts").ServerProvider> }
  | { ok: false; error: string }
> {
  try {
    const api = readEnvironmentApi(input.environmentId);
    if (!api) {
      return { ok: false, error: "环境 API 不可用。" };
    }
    const result = await api.ssh.getConnectionProviders({
      connectionId: input.connectionId,
      projectId: input.projectId,
      invalidate: true,
    });
    return { ok: true, providers: result.providers };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
