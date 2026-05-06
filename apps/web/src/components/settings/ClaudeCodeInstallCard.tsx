import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangleIcon, CheckCircleIcon, LoaderIcon } from "lucide-react";
import type { ServerProvider } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { getWsConnectionUiState, useWsConnectionStatus } from "../../rpc/wsConnectionState";

interface Props {
  installed: boolean;
  providerSnapshot?: ServerProvider | undefined;
  onRefreshProviders?: (() => void) | undefined;
  onInstallComplete: () => void;
}

const INSTALL_STATE_SYNC_INTERVAL_MS = 4_000;
const INSTALL_STALE_TIMEOUT_MS = 8 * 60_000;

export function ClaudeCodeInstallCard({
  installed,
  providerSnapshot,
  onRefreshProviders,
  onInstallComplete,
}: Props) {
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<{
    type: "started" | "success" | "failed";
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsStatus = useWsConnectionStatus();
  const wsUiState = getWsConnectionUiState(wsStatus);
  const installStartedAtRef = useRef<number | null>(null);
  const installStartVersionRef = useRef<string | null>(null);
  const installStartCheckedAtRef = useRef<string | null>(null);
  const sawConnectionDropRef = useRef(false);
  const installResolvedRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);

  const providerVersion = providerSnapshot?.version ?? null;
  const providerCheckedAt = providerSnapshot?.checkedAt ?? null;

  const clearInstallTimers = useCallback(() => {
    if (syncTimerRef.current !== null) {
      window.clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (timeoutTimerRef.current !== null) {
      window.clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const markInstallSuccess = useCallback(
    (message: string) => {
      installResolvedRef.current = true;
      clearInstallTimers();
      setProgress({ type: "success", message });
      setIsInstalling(false);
      setError(null);
      setTimeout(onInstallComplete, 600);
    },
    [clearInstallTimers, onInstallComplete],
  );

  const markInstallFailed = useCallback(
    (message: string) => {
      installResolvedRef.current = true;
      clearInstallTimers();
      setProgress({ type: "failed", message });
      setIsInstalling(false);
      setError(message);
    },
    [clearInstallTimers],
  );

  useEffect(() => {
    return () => {
      clearInstallTimers();
    };
  }, [clearInstallTimers]);

  useEffect(() => {
    if (!isInstalling) {
      return;
    }
    if (wsUiState !== "connected") {
      sawConnectionDropRef.current = true;
      setProgress((previous) =>
        previous?.type === "started"
          ? { type: "started", message: "连接中断，等待与服务端重新同步更新状态..." }
          : previous,
      );
    }
  }, [isInstalling, wsUiState]);

  useEffect(() => {
    if (!isInstalling || installResolvedRef.current) {
      return;
    }
    const startedAt = installStartedAtRef.current;
    if (!startedAt || !providerSnapshot) {
      return;
    }
    const startedVersion = installStartVersionRef.current;
    const startedCheckedAt = installStartCheckedAtRef.current;
    const versionChanged = providerSnapshot.version !== startedVersion;
    const checkedAtChanged = startedCheckedAt
      ? providerSnapshot.checkedAt > startedCheckedAt
      : providerSnapshot.checkedAt.length > 0;
    const recoveredAfterDisconnect =
      sawConnectionDropRef.current &&
      wsUiState === "connected" &&
      providerSnapshot.installed &&
      providerSnapshot.status !== "error" &&
      checkedAtChanged;

    if (versionChanged || recoveredAfterDisconnect) {
      markInstallSuccess("Claude Code 已更新完成（状态已同步）");
      return;
    }
    if (Date.now() - startedAt > INSTALL_STALE_TIMEOUT_MS) {
      markInstallFailed("更新状态同步超时，请点击刷新提供商状态后重试。");
    }
  }, [isInstalling, markInstallFailed, markInstallSuccess, providerSnapshot, wsUiState]);

  const handleInstall = useCallback(async () => {
    const api = ensureLocalApi();

    installStartedAtRef.current = Date.now();
    installStartVersionRef.current = providerVersion;
    installStartCheckedAtRef.current = providerCheckedAt;
    sawConnectionDropRef.current = false;
    installResolvedRef.current = false;
    clearInstallTimers();

    setIsInstalling(true);
    setError(null);
    setProgress({ type: "started", message: "正在安装 Claude Code..." });

    if (onRefreshProviders) {
      onRefreshProviders();
      syncTimerRef.current = window.setInterval(() => {
        onRefreshProviders();
      }, INSTALL_STATE_SYNC_INTERVAL_MS);
    }
    timeoutTimerRef.current = window.setTimeout(() => {
      if (!installResolvedRef.current) {
        markInstallFailed("更新状态同步超时，请点击刷新提供商状态后重试。");
      }
    }, INSTALL_STALE_TIMEOUT_MS);

    try {
      // Call the backend to execute the install command (server auto-detects platform)
      const result = await api.claudeCode.install();
      if (installResolvedRef.current) {
        return;
      }

      if (result.success) {
        markInstallSuccess(installed ? "Claude Code 更新成功" : "Claude Code 安装成功");
      } else {
        markInstallFailed(result.error ?? "安装失败");
      }
    } catch (err) {
      if (!installResolvedRef.current) {
        const errorMessage = err instanceof Error ? err.message : "安装失败";
        markInstallFailed(errorMessage);
      }
    }
  }, [
    clearInstallTimers,
    installed,
    markInstallFailed,
    markInstallSuccess,
    onRefreshProviders,
    providerCheckedAt,
    providerVersion,
  ]);

  const installButtonLabel = useMemo(() => {
    if (!isInstalling) {
      return installed ? "更新" : "安装";
    }
    return installed ? "更新中..." : "安装中...";
  }, [installed, isInstalling]);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          className="h-8 text-xs"
          disabled={isInstalling}
          onClick={handleInstall}
        >
          {isInstalling ? (
            <>
              <LoaderIcon className="size-3 animate-spin mr-1" />
              {installButtonLabel}
            </>
          ) : installed ? (
            "更新"
          ) : (
            "安装"
          )}
        </Button>
      </div>

      {progress && (
        <div className="flex items-center gap-2 text-xs">
          {progress.type === "started" && (
            <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
          )}
          {progress.type === "success" && <CheckCircleIcon className="size-3 text-success" />}
          {progress.type === "failed" && <AlertTriangleIcon className="size-3 text-destructive" />}
          <span
            className={cn(
              progress.type === "success" && "text-success",
              progress.type === "failed" && "text-destructive",
              progress.type === "started" && "text-muted-foreground",
            )}
          >
            {progress.message}
          </span>
        </div>
      )}

      {isInstalling && wsUiState !== "connected" ? (
        <p className="text-xs text-warning">与服务端连接异常，正在等待自动恢复并同步更新结果…</p>
      ) : null}

      {error && (
        <div className="space-y-2">
          <p className="text-xs text-destructive">{error}</p>
          <p className="text-xs text-muted-foreground">请手动安装：</p>
          <div className="space-y-1 font-mono text-xs">
            <code className="block p-2 bg-muted rounded">
              Windows: irm
              https://raw.githubusercontent.com/wyt990/claude-code-haha/main/install/install.ps1 |
              iex
            </code>
            <code className="block p-2 bg-muted rounded">
              macOS/Linux: curl -fsSL
              https://raw.githubusercontent.com/wyt990/claude-code-haha/main/install/install.sh |
              bash
            </code>
          </div>
        </div>
      )}
    </div>
  );
}
