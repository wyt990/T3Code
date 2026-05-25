import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileExplorerStore } from "./fileExplorerStore";
import { FileTreeNode } from "./FileTreeNode";
import type { ProjectDirectoryEntry } from "@t3tools/contracts";
import { readEnvironmentApi } from "../../environmentApi";
import type { EnvironmentId } from "@t3tools/contracts";
import { useUiStateStore } from "../../uiStateStore";
import { nextTabId } from "../TabBar/TabBar.logic";
import { findTabByFile } from "../../uiTabsState";

interface DirState {
  entries: ProjectDirectoryEntry[];
  status: "loading" | "loaded" | "error";
}

interface FileTreeProps {
  readonly workspaceRoot: string;
  readonly environmentId: EnvironmentId;
  readonly rootDir?: string;
}

type DialogMode = "newFile" | "newFolder" | "deleteConfirm" | null;

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? (idx === 0 ? "/" : path.slice(0, idx)) : ".";
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function FileTree({ workspaceRoot, environmentId, rootDir = "." }: FileTreeProps) {
  const expandedPaths = useFileExplorerStore((s) => s.expandedPaths);
  const toggleExpanded = useFileExplorerStore((s) => s.toggleExpanded);
  const setFileContents = useFileExplorerStore((s) => s.setFileContents);
  const contextMenu = useFileExplorerStore((s) => s.contextMenu);
  const renameTarget = useFileExplorerStore((s) => s.renameTarget);
  const refreshCounter = useFileExplorerStore((s) => s.refreshCounter);
  const storeHideContextMenu = useFileExplorerStore((s) => s.hideContextMenu);

  // 从主标签状态派生当前激活的文件路径（用于目录树高亮）
  const activeTabId = useUiStateStore((s) => s.tabs.group.activeTabId);
  const activeFilePath = useMemo(() => {
    if (!activeTabId) return null;
    const tab = useUiStateStore.getState().tabs.tabsById[activeTabId];
    return tab?.target.kind === "file" ? tab.target.filePath : null;
  }, [activeTabId]);
  const hideContextMenu = useCallback(() => {
    setContextMenuTargetPath(null);
    storeHideContextMenu();
  }, [storeHideContextMenu]);
  const setRenameTarget = useFileExplorerStore((s) => s.setRenameTarget);
  const triggerRefresh = useFileExplorerStore((s) => s.triggerRefresh);

  const [dirMap, setDirMap] = useState<Record<string, DirState>>({});
  const loadingRef = useRef<Record<string, boolean>>({});
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [contextTargetDir, setContextTargetDir] = useState("");
  const [contextMenuTargetPath, setContextMenuTargetPath] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击右键菜单外关闭
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu();
      }
    };
    // 延迟添加以避免立即触发（右键点击本身）
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [contextMenu, hideContextMenu]);

  // Escape 关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideContextMenu();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [contextMenu, hideContextMenu]);

  const loadDir = useCallback(
    async (dirPath: string) => {
      if (loadingRef.current[dirPath]) return;
      loadingRef.current[dirPath] = true;
      setDirMap((prev) => ({ ...prev, [dirPath]: { entries: [], status: "loading" } }));
      try {
        const api = readEnvironmentApi(environmentId);
        if (!api) {
          setDirMap((prev) => ({ ...prev, [dirPath]: { entries: [], status: "error" } }));
          return;
        }
        const result = await api.projects.listDirectory({
          cwd: workspaceRoot,
          relativePath: dirPath,
        });
        setDirMap((prev) => {
          const next: Record<string, DirState> = {};
          for (const key of Object.keys(prev)) {
            next[key] = prev[key]!;
          }
          next[dirPath] = { entries: result.entries as ProjectDirectoryEntry[], status: "loaded" };
          return next;
        });
      } catch {
        setDirMap((prev) => ({ ...prev, [dirPath]: { entries: [], status: "error" } }));
      } finally {
        loadingRef.current[dirPath] = false;
      }
    },
    [workspaceRoot, environmentId],
  );

  // 初始加载根目录 / 导航到新目录时重置
  useEffect(() => {
    setDirMap({});
    loadingRef.current = {};
    loadDir(rootDir);
  }, [rootDir]);

  // 展开目录时懒加载
  useEffect(() => {
    for (const dirPath of Object.keys(expandedPaths)) {
      if (expandedPaths[dirPath] && !dirMap[dirPath]) {
        loadDir(dirPath);
      }
    }
  }, [expandedPaths, loadDir, dirMap, refreshCounter]);

  // 刷新时重新加载根目录和已展开目录
  useEffect(() => {
    if (refreshCounter === 0) return;
    // 清除加载标记以强制重新加载
    loadingRef.current[rootDir] = false;
    loadDir(rootDir);
    for (const dirPath of Object.keys(expandedPaths)) {
      if (expandedPaths[dirPath]) {
        loadingRef.current[dirPath] = false;
        loadDir(dirPath);
      }
    }
  }, [refreshCounter, loadDir, expandedPaths, rootDir]);

  const handleToggle = useCallback(
    async (dirPath: string) => {
      toggleExpanded(dirPath);
      if (!dirMap[dirPath]) {
        loadDir(dirPath);
      }
    },
    [toggleExpanded, dirMap, loadDir],
  );

  const handleSelect = useCallback(
    async (filePath: string) => {
      const fileName = filePath.split("/").pop() ?? filePath;

      // 在主标签栏中创建文件标签（去重：已有同路径文件标签则直接激活）
      const currentTabs = useUiStateStore.getState().tabs;
      const existing = findTabByFile(currentTabs, filePath);
      if (existing) {
        useUiStateStore.getState().activateTab(existing.id);
      } else {
        useUiStateStore.getState().createTab(
          {
            kind: "file",
            filePath,
            workspaceRoot,
            environmentId,
            fileName,
          },
          { newTabId: nextTabId() },
        );
      }

      // 预加载文件内容
      const existingContents = useFileExplorerStore.getState().fileContents[filePath];
      if (!existingContents) {
        try {
          const api = readEnvironmentApi(environmentId);
          if (!api) return;
          const result = await api.projects.readFile({
            cwd: workspaceRoot,
            relativePath: filePath,
          });
          setFileContents(filePath, result.contents);
        } catch {
          // File read failed silently
        }
      }
    },
    [workspaceRoot, environmentId, setFileContents],
  );

  const showContextMenu = useFileExplorerStore((s) => s.showContextMenu);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, type: "file" | "directory" | "symlink" | "other") => {
      const targetDir = type === "directory" ? path : dirname(path);
      setContextTargetDir(targetDir);
      setContextMenuTargetPath(path);
      showContextMenu({ x: e.clientX, y: e.clientY, path, type });
    },
    [showContextMenu],
  );

  /** 从剪贴板读取权限 — 仅读一次，不 hold 引用 */
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 环境不支持剪贴板 API 时静默失败
    }
  };

  const handleCopyRelativePath = useCallback(async () => {
    if (!contextMenu) return;
    await copyToClipboard(contextMenu.path);
    hideContextMenu();
  }, [contextMenu, hideContextMenu]);

  const handleCopyAbsolutePath = useCallback(async () => {
    if (!contextMenu) return;
    await copyToClipboard(workspaceRoot + "/" + contextMenu.path);
    hideContextMenu();
  }, [contextMenu, workspaceRoot, hideContextMenu]);

  // ---- 操作处理 ----

  const handleCreateFile = useCallback(async () => {
    if (!dialogValue.trim()) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    const filePath =
      contextTargetDir === "." ? dialogValue.trim() : `${contextTargetDir}/${dialogValue.trim()}`;
    try {
      await api.projects.writeFile({ cwd: workspaceRoot, relativePath: filePath, contents: "" });
      setFileContents(filePath, "");
      // 在主标签栏创建文件标签
      const fileName = basename(filePath);
      useUiStateStore
        .getState()
        .createTab(
          { kind: "file", filePath, workspaceRoot, environmentId, fileName },
          { newTabId: nextTabId() },
        );
      triggerRefresh();
    } catch {
      // Silently fail
    }
    setDialogMode(null);
    setDialogValue("");
  }, [
    dialogValue,
    contextTargetDir,
    environmentId,
    workspaceRoot,
    setFileContents,
    triggerRefresh,
  ]);

  const handleCreateDirectory = useCallback(async () => {
    if (!dialogValue.trim()) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    const dirPath =
      contextTargetDir === "." ? dialogValue.trim() : `${contextTargetDir}/${dialogValue.trim()}`;
    try {
      await api.projects.createDirectory({ cwd: workspaceRoot, relativePath: dirPath });
      triggerRefresh();
    } catch {
      // Silently fail
    }
    setDialogMode(null);
    setDialogValue("");
  }, [dialogValue, contextTargetDir, environmentId, workspaceRoot, triggerRefresh]);

  const handleRenameSubmit = useCallback(
    async (newName: string) => {
      if (!renameTarget || !newName.trim() || newName.trim() === basename(renameTarget)) {
        setRenameTarget(null);
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) return;
      const parent = dirname(renameTarget);
      const toPath = parent === "." ? newName.trim() : `${parent}/${newName.trim()}`;
      try {
        await api.projects.renameFile({ cwd: workspaceRoot, fromPath: renameTarget, toPath });
        // 如果重命名的文件在标签栏中打开，更新文件标签路径
        const uiTabs = useUiStateStore.getState().tabs;
        const existingFileTab = findTabByFile(uiTabs, renameTarget);
        if (existingFileTab) {
          const state = useFileExplorerStore.getState();
          const contents = state.fileContents[renameTarget];
          // 关闭旧文件标签，创建新路径文件标签
          useUiStateStore.getState().closeTab(existingFileTab.id);
          const fileName = newName.trim();
          useUiStateStore
            .getState()
            .createTab(
              { kind: "file", filePath: toPath, workspaceRoot, environmentId, fileName },
              { newTabId: nextTabId() },
            );
          if (contents !== undefined) {
            state.setFileContents(toPath, contents);
          }
        }
        triggerRefresh();
      } catch {
        // Silently fail
      }
      setRenameTarget(null);
    },
    [renameTarget, environmentId, workspaceRoot, setRenameTarget, triggerRefresh],
  );

  const handleRenameCancel = useCallback(() => {
    setRenameTarget(null);
  }, [setRenameTarget]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    try {
      await api.projects.deleteFile({
        cwd: workspaceRoot,
        relativePath: contextMenu.path,
        recursive: true,
      });
      // 如果删除的文件在标签栏中打开，关闭对应标签
      if (contextMenu.type === "file") {
        const tabs = useUiStateStore.getState().tabs;
        const fileTab = findTabByFile(tabs, contextMenu.path);
        if (fileTab) {
          useUiStateStore.getState().closeTab(fileTab.id);
        }
      }
      triggerRefresh();
    } catch {
      // Silently fail
    }
    setDialogMode(null);
    hideContextMenu();
  }, [contextMenu, environmentId, workspaceRoot, triggerRefresh, hideContextMenu]);

  // ---- 右键菜单操作 ----

  const openNewFileDialog = () => {
    setDialogValue("");
    setDialogMode("newFile");
    hideContextMenu();
  };

  const openNewFolderDialog = () => {
    setDialogValue("");
    setDialogMode("newFolder");
    hideContextMenu();
  };

  const openRename = () => {
    if (contextMenu) {
      setRenameTarget(contextMenu.path);
      hideContextMenu();
    }
  };

  const openDeleteConfirm = () => {
    setDialogMode("deleteConfirm");
    hideContextMenu();
  };

  // ---- 对话框 ----

  const dialogTitle =
    dialogMode === "newFile" ? "新建文件" : dialogMode === "newFolder" ? "新建文件夹" : "确认删除";
  const dialogPlaceholder =
    dialogMode === "newFile" ? "文件名" : dialogMode === "newFolder" ? "文件夹名" : "";

  const renderDialog = () => {
    if (!dialogMode) return null;
    if (dialogMode === "deleteConfirm") {
      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDialogMode(null)}
        >
          <div
            className="bg-panel-background rounded-lg shadow-xl border border-border p-4 min-w-[280px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium mb-3">确认删除</div>
            <div className="text-xs text-muted-foreground mb-4">
              确定要删除{" "}
              <span className="font-mono text-foreground">
                {contextMenu ? basename(contextMenu.path) : ""}
              </span>{" "}
              吗？
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 text-xs rounded hover:bg-foreground/15"
                onClick={() => setDialogMode(null)}
              >
                取消
              </button>
              <button
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-500"
                onClick={handleDelete}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={() => setDialogMode(null)}
      >
        <div
          className="bg-panel-background rounded-lg shadow-xl border border-border p-4 min-w-[280px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm font-medium mb-3">{dialogTitle}</div>
          <input
            className="w-full bg-white/10 border border-border rounded px-2 py-1 text-sm outline-none focus:border-accent mb-3"
            placeholder={dialogPlaceholder}
            value={dialogValue}
            onChange={(e) => setDialogValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                dialogMode === "newFile" ? handleCreateFile() : handleCreateDirectory();
              }
              if (e.key === "Escape") setDialogMode(null);
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1 text-xs rounded hover:bg-foreground/15"
              onClick={() => setDialogMode(null)}
            >
              取消
            </button>
            <button
              className="px-3 py-1 text-xs rounded bg-accent text-white hover:bg-accent/80"
              onClick={dialogMode === "newFile" ? handleCreateFile : handleCreateDirectory}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderNodes = (dirPath: string, depth: number): React.ReactNode => {
    const dir = dirMap[dirPath];
    if (!dir || dir.status === "loading") {
      return depth === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">加载中...</div>
      ) : null;
    }
    if (dir.status === "error") {
      return depth === 0 ? (
        <div className="px-3 py-2 text-xs text-red-400">加载失败，请检查路径是否正确或刷新重试</div>
      ) : null;
    }

    return dir.entries.map((entry) => {
      const childPath = entry.fullPath;
      const isExpanded = !!expandedPaths[childPath];

      return (
        <div key={childPath}>
          <FileTreeNode
            name={entry.name}
            fullPath={childPath}
            type={entry.type}
            depth={depth}
            isExpanded={isExpanded}
            isSelected={activeFilePath === childPath}
            isContextMenuTarget={contextMenuTargetPath === childPath}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
            isRenaming={renameTarget === childPath}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={handleRenameCancel}
          />
          {entry.type === "directory" && isExpanded && renderNodes(childPath, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="py-1 text-sm relative">
      {renderNodes(rootDir, 0)}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] bg-popover border border-border rounded-lg shadow-2xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-foreground/15 flex items-center gap-2"
            onClick={openNewFileDialog}
          >
            <span className="text-muted-foreground">+</span> 新建文件
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-foreground/15 flex items-center gap-2"
            onClick={openNewFolderDialog}
          >
            <span className="text-muted-foreground">+</span> 新建文件夹
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-foreground/15 flex items-center gap-2"
            onClick={handleCopyRelativePath}
          >
            复制相对路径
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-foreground/15 flex items-center gap-2"
            onClick={handleCopyAbsolutePath}
          >
            复制绝对路径
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-foreground/15 flex items-center gap-2"
            onClick={openRename}
          >
            重命名
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-foreground/15 flex items-center gap-2 text-red-400"
            onClick={openDeleteConfirm}
          >
            删除
          </button>
        </div>
      )}

      {/* 对话框 */}
      {renderDialog()}
    </div>
  );
}
