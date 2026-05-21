import type { ConnectConfig } from "ssh2";

/** SSH handshake timeout (ms). */
export const SSH_READY_TIMEOUT_MS = 20_000;

/** SSH-level keepalive interval (ms); doc step 13 recommends 30s. */
export const SSH_KEEPALIVE_INTERVAL_MS = 30_000;

/** Consecutive missed keepalives before the client disconnects. */
export const SSH_KEEPALIVE_COUNT_MAX = 3;

/** Default timeout for one-shot remote `exec` (ms). */
export const SSH_EXEC_TIMEOUT_MS = 120_000;

export const defaultSshConnectConfigFields = (): Pick<
  ConnectConfig,
  "readyTimeout" | "keepaliveInterval" | "keepaliveCountMax"
> => ({
  readyTimeout: SSH_READY_TIMEOUT_MS,
  keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
  keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
});
