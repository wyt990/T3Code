import type { ProviderKind, ServerProvider, ServerProviderModel } from "@t3tools/contracts";

import type { RemoteProviderProbeResult } from "../remoteProviderProbe.ts";

/**
 * Filter providers by SSH probe results.
 *
 * For each provider:
 * - If probe says binary is available → keep as-is
 * - If probe says binary is NOT available → set enabled=false with message
 * - If no probe result (connection not probed yet) → keep as-is
 */
export const filterProvidersByConnection = (
  providers: ReadonlyArray<ServerProvider>,
  probes: ReadonlyMap<ProviderKind, RemoteProviderProbeResult>,
): ReadonlyArray<ServerProvider> =>
  providers.map((provider) => {
    const probe = probes.get(provider.provider);
    if (!probe) {
      return provider; // not probed yet, keep as-is
    }
    if (!probe.available) {
      return {
        ...provider,
        enabled: false,
        message: provider.displayName
          ? `${provider.displayName} is not available on the SSH remote server.`
          : "This provider is not available on the SSH remote server.",
      } satisfies ServerProvider;
    }
    return provider;
  });

/**
 * Replace provider models with remote-probed models.
 */
export const replaceProviderModels = (
  provider: ServerProvider,
  models: ReadonlyArray<ServerProviderModel>,
): ServerProvider => ({
  ...provider,
  models,
});
