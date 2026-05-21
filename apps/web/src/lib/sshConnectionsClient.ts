import type {
  SshConfirmHostKeyInput,
  SshConnectionSummary,
  SshDeleteConnectionInput,
  SshListProviderProbesInput,
  SshListProviderProbesResult,
  SshSecretKind,
  SshTestConnectionInput,
  SshTestConnectionResult,
  SshUpsertConnectionInput,
} from "@t3tools/contracts";

import { readEnvironmentApi } from "../environmentApi";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { readLocalApi } from "../localApi";

async function readSshEnvironmentApi() {
  try {
    const connection = getPrimaryEnvironmentConnection();
    const environmentId = connection.knownEnvironment.environmentId;
    if (!environmentId) {
      return undefined;
    }
    return readEnvironmentApi(environmentId);
  } catch {
    return undefined;
  }
}

export async function listSshConnections(): Promise<ReadonlyArray<SshConnectionSummary>> {
  if (typeof window !== "undefined" && window.desktopBridge) {
    return window.desktopBridge.listSshConnections();
  }

  const api = await readSshEnvironmentApi();
  return api ? api.ssh.listConnections() : [];
}

export async function upsertSshConnection(
  input: SshUpsertConnectionInput,
): Promise<SshConnectionSummary> {
  if (typeof window !== "undefined" && window.desktopBridge) {
    return window.desktopBridge.upsertSshConnection(input);
  }

  const api = await readSshEnvironmentApi();
  if (!api) {
    throw new Error("环境未连接，无法保存 SSH 连接。");
  }
  return api.ssh.upsertConnection(input);
}

export async function deleteSshConnection(input: SshDeleteConnectionInput): Promise<void> {
  if (typeof window !== "undefined" && window.desktopBridge) {
    await window.desktopBridge.deleteSshConnection(input);
    return;
  }

  const api = await readSshEnvironmentApi();
  if (!api) {
    throw new Error("环境未连接，无法删除 SSH 连接。");
  }
  await api.ssh.deleteConnection(input);
}

export async function setSshSecret(
  connectionId: string,
  kind: SshSecretKind,
  value: string,
): Promise<boolean> {
  const localApi = readLocalApi();
  if (!localApi) {
    return false;
  }
  return localApi.persistence.setSshSecret(connectionId, kind, value);
}

export async function testSshConnection(
  input: SshTestConnectionInput,
): Promise<SshTestConnectionResult> {
  const api = await readSshEnvironmentApi();
  if (!api) {
    throw new Error("环境未连接，无法测试 SSH 连接。");
  }
  return api.ssh.testConnection(input);
}

export async function listSshProviderProbes(
  input: SshListProviderProbesInput,
): Promise<SshListProviderProbesResult> {
  const api = await readSshEnvironmentApi();
  if (!api) {
    throw new Error("环境未连接，无法读取远程 CLI 探测结果。");
  }
  return api.ssh.listProviderProbes(input);
}

export async function confirmSshHostKey(input: SshConfirmHostKeyInput): Promise<void> {
  const api = await readSshEnvironmentApi();
  if (!api) {
    throw new Error("环境未连接，无法确认主机密钥。");
  }
  await api.ssh.confirmHostKey(input);
}

export function canStoreSshSecrets(): boolean {
  return typeof window !== "undefined" && window.desktopBridge !== undefined;
}
