import { useCallback, useEffect, useState } from "react";
import { AlertTriangleIcon, CheckCircleIcon, LoaderIcon } from "lucide-react";
import type {
  ProviderInstallProgressEvent,
  InstallMethodSchema,
  ProviderKind,
} from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";

interface Props {
  provider: ProviderKind;
  onInstallComplete: () => void;
}

export function ProviderInstallCard({ provider, onInstallComplete }: Props) {
  const [methods, setMethods] = useState<ReadonlyArray<InstallMethodSchema>>([]);
  const [recommended, setRecommended] = useState<InstallMethodSchema | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<ProviderInstallProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMethods, setIsLoadingMethods] = useState(true);

  const loadMethods = useCallback(async () => {
    setIsLoadingMethods(true);
    try {
      const api = ensureLocalApi();
      const result = await api.provider.getInstallMethods();
      setMethods(result.methods);
      setRecommended(result.recommended ?? null);
      setSelectedMethod(result.recommended?.id ?? result.methods[0]?.id ?? null);
    } catch (err) {
      console.error("Failed to load install methods:", err);
    } finally {
      setIsLoadingMethods(false);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    if (!selectedMethod) return;

    const method = methods.find((m) => m.id === selectedMethod);
    if (!method) return;

    // Show confirmation for YOLO or sudo methods
    if (method.isYolo) {
      const confirmed = window.confirm(
        "此安装方法将从 opencode.ai 下载并执行脚本。\n\n" +
          "虽然方便，但此方法：\n" +
          "- 从网络下载代码而不验证\n" +
          "- 以您的用户权限执行\n" +
          "- 比包管理器安装安全性较低\n\n" +
          "建议使用 npm、bun 或 Homebrew。\n\n" +
          "仍要继续吗？",
      );
      if (!confirmed) return;
    }

    if (method.requiresSudo) {
      const confirmed = window.confirm(
        `此安装方法 (${method.label}) 需要管理员权限。\n\n` +
          "您可能会被提示输入密码。\n\n" +
          "继续吗？",
      );
      if (!confirmed) return;
    }

    setIsInstalling(true);
    setError(null);
    setProgress(null);

    try {
      const api = ensureLocalApi();
      await api.provider.install(provider, {
        preferredMethod: selectedMethod as any,
        onProgress: (event) => {
          setProgress(event);
          if (event.type === "success") {
            setTimeout(onInstallComplete, 1000);
          }
          if (event.type === "failed" && !event.nextMethod) {
            setError(event.message);
          }
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装失败");
    } finally {
      setIsInstalling(false);
    }
  }, [provider, selectedMethod, methods, onInstallComplete]);

  useEffect(() => {
    loadMethods();
  }, [loadMethods]);

  if (isLoadingMethods) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderIcon className="size-3 animate-spin" />
        <span>加载安装方法...</span>
      </div>
    );
  }

  if (methods.length === 0) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">没有可用的自动安装方法。请手动安装：</p>
        <div className="space-y-1 font-mono text-xs">
          <code className="block p-2 bg-muted rounded">npm i -g opencode-ai@latest</code>
          <code className="block p-2 bg-muted rounded">bun i -g opencode-ai@latest</code>
        </div>
        <a
          href="https://opencode.ai/docs/installation"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline"
        >
          查看完整安装指南
        </a>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Select value={selectedMethod ?? ""} onValueChange={setSelectedMethod}>
          <SelectTrigger className="flex-1 h-8 text-xs">
            <SelectValue placeholder="选择安装方法" />
          </SelectTrigger>
          <SelectPopup>
            {methods.map((method) => (
              <SelectItem key={method.id} value={method.id}>
                <span>
                  {method.label}
                  {method.id === recommended?.id && " (推荐)"}
                  {method.isYolo && " (安全性较低)"}
                  {method.requiresSudo && " (需要权限)"}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <Button
          size="sm"
          variant="default"
          className="h-8 text-xs"
          disabled={!selectedMethod || isInstalling}
          onClick={handleInstall}
        >
          {isInstalling ? (
            <>
              <LoaderIcon className="size-3 animate-spin mr-1" />
              安装中...
            </>
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
          {progress.type === "failed" && !progress.nextMethod && (
            <AlertTriangleIcon className="size-3 text-destructive" />
          )}
          {progress.type === "fallback" && <AlertTriangleIcon className="size-3 text-warning" />}
          <span
            className={cn(
              progress.type === "success" && "text-success",
              progress.type === "failed" && !progress.nextMethod && "text-destructive",
              progress.type === "fallback" && "text-warning",
              !["success", "failed", "fallback"].includes(progress.type) && "text-muted-foreground",
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
            <code className="block p-2 bg-muted rounded">npm i -g opencode-ai@latest</code>
          </div>
          <a
            href="https://opencode.ai/docs/installation"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            查看完整安装指南
          </a>
        </div>
      )}
    </div>
  );
}
