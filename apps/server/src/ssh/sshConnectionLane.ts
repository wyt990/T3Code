/**
 * Logical SSH lanes: one pooled TCP/SSH session per (connectionId, lane).
 * Avoids exec/shell/SFTP channel contention on a single ssh2 client.
 */
export const SSH_CONNECTION_LANES = ["git", "probe", "interactive", "workspace", "browse"] as const;

export type SshConnectionLane = (typeof SSH_CONNECTION_LANES)[number];

export const DEFAULT_SSH_CONNECTION_LANE: SshConnectionLane = "workspace";

const LANE_KEY_SEPARATOR = "::";

export const resolvePooledConnectionKey = (
  connectionId: string,
  lane: SshConnectionLane = DEFAULT_SSH_CONNECTION_LANE,
): string => `${connectionId}${LANE_KEY_SEPARATOR}${lane}`;

export const parsePooledConnectionKey = (
  pooledKey: string,
): { readonly connectionId: string; readonly lane: SshConnectionLane } => {
  const separatorIndex = pooledKey.indexOf(LANE_KEY_SEPARATOR);
  if (separatorIndex < 0) {
    return { connectionId: pooledKey, lane: DEFAULT_SSH_CONNECTION_LANE };
  }
  const connectionId = pooledKey.slice(0, separatorIndex);
  const laneRaw = pooledKey.slice(separatorIndex + LANE_KEY_SEPARATOR.length);
  const lane = SSH_CONNECTION_LANES.includes(laneRaw as SshConnectionLane)
    ? (laneRaw as SshConnectionLane)
    : DEFAULT_SSH_CONNECTION_LANE;
  return { connectionId, lane };
};

export const pooledConnectionKeysForConnection = (connectionId: string): ReadonlyArray<string> =>
  SSH_CONNECTION_LANES.map((lane) => resolvePooledConnectionKey(connectionId, lane));

export const matchesConnectionId = (pooledKey: string, connectionId: string): boolean =>
  pooledKey === connectionId || pooledKey.startsWith(`${connectionId}${LANE_KEY_SEPARATOR}`);
