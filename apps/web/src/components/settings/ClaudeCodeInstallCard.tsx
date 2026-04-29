import { useCallback, useState } from "react";
import { AlertTriangleIcon, CheckCircleIcon, LoaderIcon } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";

interface Props {
  installed: boolean;
  onInstallComplete: () => void;
}

export function ClaudeCodeInstallCard({ installed, onInstallComplete }: Props) {
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<{
    type: "started" | "success" | "failed";
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = useCallback(async () => {
    const api = ensureLocalApi();

    setIsInstalling(true);
    setError(null);
    setProgress({ type: "started", message: "正在安装 Claude Code..." });

    try {
      // Call the backend to execute the install command (server auto-detects platform)
      const result = await api.claudeCode.install();

      if (result.success) {
        setProgress({
          type: "success",
          message: "Claude Code 安装成功",
        });
        setTimeout(onInstallComplete, 1000);
      } else {
        setError(result.error ?? "安装失败");
        setProgress({
          type: "failed",
          message: result.error ?? "安装失败",
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "安装失败";
      setError(errorMessage);
      setProgress({ type: "failed", message: errorMessage });
    } finally {
      setIsInstalling(false);
    }
  }, [onInstallComplete]);

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
              {installed ? "更新中..." : "安装中..."}
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
