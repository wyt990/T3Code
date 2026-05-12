import * as Effect from "effect/Effect";
import { NetService } from "@t3tools/shared/Net";

export const DEFAULT_DESKTOP_BACKEND_PORT = 3773;
const MAX_TCP_PORT = 65_535;

export interface ResolveDesktopBackendPortOptions {
  readonly host: string;
  readonly startPort?: number;
  readonly maxPort?: number;
  readonly requiredHosts?: ReadonlyArray<string>;
  readonly canListenOnHost?: (port: number, host: string) => Promise<boolean>;
}

const defaultCanListenOnHost = async (port: number, host: string): Promise<boolean> =>
  Effect.service(NetService).pipe(
    Effect.flatMap((net) => net.canListenOnHost(port, host)),
    Effect.provide(NetService.layer),
    Effect.runPromise,
  );

const isValidPort = (port: number): boolean =>
  Number.isInteger(port) && port >= 1 && port <= MAX_TCP_PORT;

const normalizeHosts = (
  host: string,
  requiredHosts: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.from(
    new Set(
      [host, ...requiredHosts]
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length > 0),
    ),
  );

async function canListenOnAllHosts(
  port: number,
  hosts: ReadonlyArray<string>,
  canListenOnHost: (port: number, host: string) => Promise<boolean>,
): Promise<boolean> {
  for (const candidateHost of hosts) {
    if (!(await canListenOnHost(port, candidateHost))) {
      return false;
    }
  }

  return true;
}

// 并行检测多个端口，加速端口扫描过程
async function findAvailablePortInBatch(
  ports: number[],
  hosts: ReadonlyArray<string>,
  canListenOnHost: (port: number, host: string) => Promise<boolean>,
): Promise<number | null> {
  const results = await Promise.all(
    ports.map(async (port) => {
      const canListen = await canListenOnAllHosts(port, hosts, canListenOnHost);
      return canListen ? port : null;
    }),
  );

  // 返回第一个可用的端口（按顺序）
  for (const port of results) {
    if (port !== null) return port;
  }
  return null;
}

export async function resolveDesktopBackendPort({
  host,
  startPort = DEFAULT_DESKTOP_BACKEND_PORT,
  maxPort = MAX_TCP_PORT,
  requiredHosts = [],
  canListenOnHost = defaultCanListenOnHost,
}: ResolveDesktopBackendPortOptions): Promise<number> {
  if (!isValidPort(startPort)) {
    throw new Error(`Invalid desktop backend start port: ${startPort}`);
  }

  if (!isValidPort(maxPort)) {
    throw new Error(`Invalid desktop backend max port: ${maxPort}`);
  }

  if (maxPort < startPort) {
    throw new Error(`Desktop backend max port ${maxPort} is below start port ${startPort}`);
  }

  const hostsToCheck = normalizeHosts(host, requiredHosts);

  // 并行批处理端口扫描：每次检测 10 个端口，显著加速启动过程
  // 默认从 3773 开始，通常前几个端口就能找到可用的
  const BATCH_SIZE = 10;
  for (let batchStart = startPort; batchStart <= maxPort; batchStart += BATCH_SIZE) {
    const batchPorts: number[] = [];
    for (let port = batchStart; port <= Math.min(batchStart + BATCH_SIZE - 1, maxPort); port += 1) {
      batchPorts.push(port);
    }

    const availablePort = await findAvailablePortInBatch(batchPorts, hostsToCheck, canListenOnHost);
    if (availablePort !== null) {
      return availablePort;
    }
  }

  throw new Error(
    `No desktop backend port is available on hosts ${hostsToCheck.join(", ")} between ${startPort} and ${maxPort}`,
  );
}
