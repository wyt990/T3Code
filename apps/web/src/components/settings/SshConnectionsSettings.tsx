"use client";

import type {
  SshAuthType,
  SshConnectionSummary,
  SshHostKeyPrompt,
  SshProviderProbeEntry,
} from "@t3tools/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, ServerIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  canStoreSshSecrets,
  confirmSshHostKey,
  deleteSshConnection,
  listSshConnections,
  listSshProviderProbes,
  setSshSecret,
  testSshConnection,
  upsertSshConnection,
} from "../../lib/sshConnectionsClient";
import { isElectron } from "../../env";
import { readLocalApi } from "../../localApi";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";

const SSH_CONNECTIONS_QUERY_KEY = ["ssh", "connections"] as const;

type ConnectionDraft = {
  readonly id?: string;
  readonly label: string;
  readonly host: string;
  readonly port: string;
  readonly username: string;
  readonly authType: SshAuthType;
  readonly privateKeyPath: string;
  readonly password: string;
  readonly passphrase: string;
};

const emptyDraft = (): ConnectionDraft => ({
  label: "",
  host: "",
  port: "22",
  username: "",
  authType: "password",
  privateKeyPath: "",
  password: "",
  passphrase: "",
});

function draftFromConnection(connection: SshConnectionSummary): ConnectionDraft {
  return {
    id: connection.id,
    label: connection.label,
    host: connection.host,
    port: String(connection.port),
    username: connection.username,
    authType: connection.authType,
    privateKeyPath: connection.privateKeyPath ?? "",
    password: "",
    passphrase: "",
  };
}

function statusLabel(status: SshConnectionSummary["status"]): string {
  switch (status) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "error":
      return "错误";
    default:
      return "未连接";
  }
}

function formatProviderProbeLine(probe: SshProviderProbeEntry): string {
  const name = PROVIDER_DISPLAY_NAMES[probe.provider];
  if (!probe.available) {
    return probe.error ? `${name}：未检测到（${probe.error}）` : `${name}：未检测到`;
  }
  const details = [probe.binaryPath, probe.version].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return details.length > 0 ? `${name}：${details.join(" · ")}` : `${name}：已检测到`;
}

export function SshConnectionsSettings() {
  const queryClient = useQueryClient();
  const secretStorageAvailable = canStoreSshSecrets();
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft);
  const [pendingHostKey, setPendingHostKey] = useState<{
    readonly connectionId: string;
    readonly hostKey: SshHostKeyPrompt;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SshConnectionSummary | null>(null);
  const [providerProbesByConnection, setProviderProbesByConnection] = useState<
    Record<string, ReadonlyArray<SshProviderProbeEntry>>
  >({});
  const [probesLoadingConnectionId, setProbesLoadingConnectionId] = useState<string | null>(null);

  const connectionsQuery = useQuery({
    queryKey: SSH_CONNECTIONS_QUERY_KEY,
    queryFn: listSshConnections,
  });

  const invalidateConnections = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: SSH_CONNECTIONS_QUERY_KEY });
  }, [queryClient]);

  const refreshProviderProbes = useCallback(async (connectionId: string) => {
    setProbesLoadingConnectionId(connectionId);
    try {
      const result = await listSshProviderProbes({ connectionId });
      setProviderProbesByConnection((current) => ({
        ...current,
        [connectionId]: result.probes,
      }));
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法读取远程 CLI 探测结果",
          description: error instanceof Error ? error.message : "发生错误。",
        }),
      );
    } finally {
      setProbesLoadingConnectionId(null);
    }
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (input: ConnectionDraft) => {
      const port = Number.parseInt(input.port, 10);
      if (!Number.isFinite(port) || port <= 0) {
        throw new Error("端口无效。");
      }

      const summary = await upsertSshConnection({
        ...(input.id ? { id: input.id } : {}),
        label: input.label.trim(),
        host: input.host.trim(),
        port,
        username: input.username.trim(),
        authType: input.authType,
        ...(input.privateKeyPath.trim().length > 0
          ? { privateKeyPath: input.privateKeyPath.trim() }
          : {}),
      });

      if (input.authType === "password" && input.password.length > 0) {
        const stored = await setSshSecret(summary.id, "password", input.password);
        if (!stored) {
          throw new Error("无法保存密码。Desktop 应用需要可用的系统加密存储。");
        }
      }

      if (input.authType === "privateKey" && input.passphrase.length > 0) {
        const stored = await setSshSecret(summary.id, "passphrase", input.passphrase);
        if (!stored) {
          throw new Error("无法保存私钥口令。Desktop 应用需要可用的系统加密存储。");
        }
      }

      return summary;
    },
    onSuccess: async () => {
      await invalidateConnections();
      setEditorOpen(false);
      setDraft(emptyDraft());
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "SSH 连接已保存",
        }),
      );
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "保存失败",
          description: error instanceof Error ? error.message : "发生错误。",
        }),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (connection: SshConnectionSummary) => {
      await deleteSshConnection({ id: connection.id });
      const localApi = readLocalApi();
      if (localApi) {
        await localApi.persistence.removeSshSecrets(connection.id);
      }
    },
    onSuccess: async () => {
      await invalidateConnections();
      setDeleteTarget(null);
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "SSH 连接已删除",
        }),
      );
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "删除失败",
          description: error instanceof Error ? error.message : "发生错误。",
        }),
      );
    },
  });

  const testMutation = useMutation({
    mutationFn: async (connectionId: string) => testSshConnection({ connectionId }),
    onSuccess: async (result, connectionId) => {
      if (result.ok) {
        await invalidateConnections();
        await refreshProviderProbes(connectionId);
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "连接测试成功",
          }),
        );
        return;
      }

      if (result.hostKey) {
        setPendingHostKey({ connectionId, hostKey: result.hostKey });
        return;
      }

      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "连接测试失败",
          description: result.error ?? "无法连接到远程主机。",
        }),
      );
      await invalidateConnections();
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "连接测试失败",
          description: error instanceof Error ? error.message : "发生错误。",
        }),
      );
    },
  });

  const confirmHostKeyMutation = useMutation({
    mutationFn: async (input: {
      readonly connectionId: string;
      readonly hostKey: SshHostKeyPrompt;
    }) => {
      await confirmSshHostKey(input.hostKey);
      return testSshConnection({ connectionId: input.connectionId });
    },
    onSuccess: async (result, variables) => {
      setPendingHostKey(null);
      if (result.ok) {
        await invalidateConnections();
        await refreshProviderProbes(variables.connectionId);
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "主机密钥已信任，连接测试成功",
          }),
        );
        return;
      }

      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "连接测试失败",
          description: result.error ?? "无法连接到远程主机。",
        }),
      );
      await invalidateConnections();
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法确认主机密钥",
          description: error instanceof Error ? error.message : "发生错误。",
        }),
      );
    },
  });

  const connections = connectionsQuery.data ?? [];
  const isSaving = saveMutation.isPending;
  const testingConnectionId = testMutation.isPending ? testMutation.variables : null;

  const editorTitle = useMemo(() => (draft.id ? "编辑 SSH 连接" : "新建 SSH 连接"), [draft.id]);

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="SSH 连接"
        icon={<ServerIcon className="size-3.5" />}
        headerAction={
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setDraft(emptyDraft());
              setEditorOpen(true);
            }}
          >
            <PlusIcon className="size-3.5" />
            添加连接
          </Button>
        }
      >
        {!isElectron ? (
          <SettingsRow
            title="Desktop 推荐"
            description="在纯 Web 模式下可管理连接元数据；密码与私钥口令需使用 Desktop 应用保存，或使用 ssh-agent / 本机私钥路径。"
          />
        ) : null}

        {connectionsQuery.isPending ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            正在加载 SSH 连接…
          </div>
        ) : null}

        {!connectionsQuery.isPending && connections.length === 0 ? (
          <SettingsRow
            title="暂无 SSH 连接"
            description="添加远程服务器后，可在命令面板中创建 SSH 远程项目。"
          />
        ) : null}

        {connections.map((connection) => {
          const providerProbes = providerProbesByConnection[connection.id];
          const probesLoading = probesLoadingConnectionId === connection.id;

          return (
            <SettingsRow
              key={connection.id}
              title={connection.label}
              description={`${connection.username}@${connection.host}:${connection.port}`}
              status={
                <span className="text-xs text-muted-foreground">
                  {statusLabel(connection.status)}
                </span>
              }
              control={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={
                      probesLoading ||
                      testingConnectionId === connection.id ||
                      confirmHostKeyMutation.isPending
                    }
                    onClick={() => void refreshProviderProbes(connection.id)}
                  >
                    {probesLoading ? <Spinner className="size-3.5" /> : null}
                    远程 CLI
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={
                      testingConnectionId === connection.id || confirmHostKeyMutation.isPending
                    }
                    onClick={() => testMutation.mutate(connection.id)}
                  >
                    {testingConnectionId === connection.id ? (
                      <Spinner className="size-3.5" />
                    ) : null}
                    测试连接
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setDraft(draftFromConnection(connection));
                      setEditorOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setDeleteTarget(connection)}
                  >
                    <Trash2Icon className="size-3.5" />
                    删除
                  </Button>
                </div>
              }
            >
              {providerProbes && providerProbes.length > 0 ? (
                <ul className="space-y-0.5 pb-4 text-xs text-muted-foreground">
                  {providerProbes.map((probe) => (
                    <li key={probe.provider}>{formatProviderProbeLine(probe)}</li>
                  ))}
                </ul>
              ) : null}
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogPopup>
          <DialogPanel className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editorTitle}</DialogTitle>
              <DialogDescription>
                连接元数据保存在本机；密码与私钥口令不会写入 ssh-connections.json。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-2">
              <label className="grid gap-1 text-sm">
                <span>显示名称</span>
                <Input
                  value={draft.label}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, label: event.target.value }))
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span>主机</span>
                  <Input
                    value={draft.host}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, host: event.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>端口</span>
                  <Input
                    value={draft.port}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, port: event.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                <span>用户名</span>
                <Input
                  value={draft.username}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, username: event.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span>认证方式</span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.authType}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      authType: event.target.value as SshAuthType,
                    }))
                  }
                >
                  <option value="password">密码</option>
                  <option value="privateKey">私钥文件</option>
                  <option value="agent">SSH Agent</option>
                </select>
              </label>

              {draft.authType === "password" ? (
                <label className="grid gap-1 text-sm">
                  <span>密码</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    disabled={!secretStorageAvailable}
                    placeholder={
                      secretStorageAvailable ? "留空则保留已保存的密码" : "仅 Desktop 可保存密码"
                    }
                    value={draft.password}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, password: event.target.value }))
                    }
                  />
                </label>
              ) : null}

              {draft.authType === "privateKey" ? (
                <>
                  <label className="grid gap-1 text-sm">
                    <span>私钥路径（本机）</span>
                    <Input
                      value={draft.privateKeyPath}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, privateKeyPath: event.target.value }))
                      }
                      placeholder="例如 C:\Users\you\.ssh\id_ed25519"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>私钥口令（可选）</span>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      disabled={!secretStorageAvailable}
                      placeholder={
                        secretStorageAvailable ? "留空则保留已保存的口令" : "仅 Desktop 可保存口令"
                      }
                      value={draft.passphrase}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, passphrase: event.target.value }))
                      }
                    />
                  </label>
                </>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditorOpen(false)}>
                取消
              </Button>
              <Button disabled={isSaving} onClick={() => saveMutation.mutate(draft)}>
                {isSaving ? <Spinner className="size-3.5" /> : null}
                保存
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 SSH 连接？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{deleteTarget?.label}」及其已保存的密码/口令。已创建的 SSH
              远程项目不会自动删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget);
                }
              }}
            >
              删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        open={pendingHostKey !== null}
        onOpenChange={(open) => !open && setPendingHostKey(null)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>信任此主机密钥？</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs leading-relaxed">
              {pendingHostKey
                ? `${pendingHostKey.hostKey.host}:${pendingHostKey.hostKey.port}\n${pendingHostKey.hostKey.fingerprint}`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>取消</AlertDialogClose>
            <Button
              disabled={confirmHostKeyMutation.isPending}
              onClick={() => {
                if (pendingHostKey) {
                  confirmHostKeyMutation.mutate(pendingHostKey);
                }
              }}
            >
              信任并继续测试
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsPageContainer>
  );
}
