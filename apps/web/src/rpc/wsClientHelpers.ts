import { getPrimaryEnvironmentConnection } from "../environments/runtime";

import type { WsRpcClient } from "./wsRpcClient";

export function readPrimaryWsRpcClient(): WsRpcClient | undefined {
  try {
    return getPrimaryEnvironmentConnection().client;
  } catch {
    return undefined;
  }
}
