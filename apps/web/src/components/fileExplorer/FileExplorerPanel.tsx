import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { FileTree } from "./FileTree";
import { useFileExplorerStore } from "./fileExplorerStore";
import { readEnvironmentApi } from "../../environmentApi";
import { cn } from "~/lib/utils";

// 按 session 记忆用户手动输入的目录路径
const sessionDirMemory = new Map<string, string>();

interface FileExplorerPanelProps {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly sessionKey: string;
  readonly className?: string;
}

export function FileExplorerPanel({
  environmentId,
  workspaceRoot,
  sessionKey,
  className,
}: FileExplorerPanelProps) {
  const triggerRefresh = useFileExplorerStore((s) => s.triggerRefresh);

  const [showInput, setShowInput] = useState<"file" | "folder" | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 地址栏 — 默认显示项目绝对路径，支持输入任意路径导航
  const [addressValue, setAddressValue] = useState(workspaceRoot);
  const [currentRootDir, setCurrentRootDir] = useState(workspaceRoot);
  const addressBarRef = useRef<HTMLInputElement>(null);
  const rememberedSessionRef = useRef<string | null>(null);

  // 切换会话标签时，恢复该会话记忆的目录；未记忆则使用项目根目录
  useEffect(() => {
    if (sessionKey === rememberedSessionRef.current) return;
    rememberedSessionRef.current = sessionKey;
    const saved = sessionDirMemory.get(sessionKey);
    const dir = saved ?? workspaceRoot;
    setAddressValue(dir);
    setCurrentRootDir(dir);
  }, [sessionKey, workspaceRoot]);

  const handleCreate = useCallback(async () => {
    if (!inputValue.trim()) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    try {
      if (showInput === "file") {
        await api.projects.writeFile({
          cwd: workspaceRoot,
          relativePath: inputValue.trim(),
          contents: "",
        });
      } else {
        await api.projects.createDirectory({ cwd: workspaceRoot, relativePath: inputValue.trim() });
      }
      triggerRefresh();
    } catch {
      // Silently fail
    }
    setShowInput(null);
    setInputValue("");
  }, [showInput, inputValue, environmentId, workspaceRoot, triggerRefresh]);

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0">
        <button
          className="px-2 py-0.5 text-xs rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setShowInput("file");
            setInputValue("");
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          title="新建文件"
        >
          + 文件
        </button>
        <button
          className="px-2 py-0.5 text-xs rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setShowInput("folder");
            setInputValue("");
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          title="新建文件夹"
        >
          + 文件夹
        </button>
        <div className="flex-1" />
        <button
          className="px-2 py-0.5 text-xs rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
          onClick={triggerRefresh}
          title="刷新"
        >
          ↻
        </button>
      </div>
      {/* 地址栏 */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0">
        <input
          ref={addressBarRef}
          className="flex-1 bg-white/10 border border-border rounded px-1.5 py-0.5 text-xs outline-none focus:border-accent min-w-0 font-mono"
          placeholder="输入路径..."
          value={addressValue}
          onChange={(e) => setAddressValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const trimmed = addressValue.trim();
              const dir = trimmed || workspaceRoot;
              sessionDirMemory.set(sessionKey, dir);
              setCurrentRootDir(dir);
              setAddressValue(dir);
            }
          }}
        />
        <button
          className="px-1.5 py-0.5 text-xs rounded hover:bg-white/10 text-muted-foreground hover:text-foreground shrink-0"
          title="转到此路径"
          onClick={() => {
            const trimmed = addressValue.trim();
            const dir = trimmed || workspaceRoot;
            sessionDirMemory.set(sessionKey, dir);
            setCurrentRootDir(dir);
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
        </button>
      </div>

      {/* 行内输入框 */}
      {showInput && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-border">
          <span className="text-xs text-muted-foreground shrink-0">
            {showInput === "file" ? "📄" : "📁"}
          </span>
          <input
            ref={inputRef}
            className="flex-1 bg-white/10 border border-border rounded px-1.5 py-0.5 text-xs outline-none focus:border-accent min-w-0"
            placeholder={showInput === "file" ? "文件名 (如: src/foo.ts)" : "文件夹名"}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") {
                setShowInput(null);
                setInputValue("");
              }
            }}
            onBlur={() => {
              if (!inputValue.trim()) {
                setShowInput(null);
              }
            }}
          />
          <button
            className="text-xs px-1.5 py-0.5 rounded hover:bg-white/10 text-muted-foreground"
            onClick={() => {
              setShowInput(null);
              setInputValue("");
            }}
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <FileTree
          workspaceRoot={workspaceRoot}
          environmentId={environmentId}
          rootDir={currentRootDir}
        />
      </div>
    </div>
  );
}
