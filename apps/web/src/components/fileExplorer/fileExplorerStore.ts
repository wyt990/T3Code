import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly path: string;
  readonly type: "file" | "directory" | "symlink" | "other";
}

interface FileExplorerState {
  expandedPaths: Record<string, boolean>;
  fileContents: Record<string, string>;
  fileDirty: Record<string, boolean>;
  contextMenu: ContextMenuState | null;
  renameTarget: string | null;
  refreshCounter: number;
}

interface FileExplorerActions {
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  setFileContents: (path: string, contents: string) => void;
  updateFileContents: (path: string, contents: string) => void;
  setFileDirty: (path: string, dirty: boolean) => void;
  showContextMenu: (state: ContextMenuState) => void;
  hideContextMenu: () => void;
  setRenameTarget: (path: string | null) => void;
  triggerRefresh: () => void;
}

export const useFileExplorerStore = create<FileExplorerState & FileExplorerActions>()(
  persist(
    (set) => ({
      expandedPaths: {},
      fileContents: {},
      fileDirty: {},
      contextMenu: null,
      renameTarget: null,
      refreshCounter: 0,

      toggleExpanded: (path) =>
        set((s) => ({
          expandedPaths: { ...s.expandedPaths, [path]: !s.expandedPaths[path] },
        })),
      setExpanded: (path, expanded) =>
        set((s) => ({
          expandedPaths: { ...s.expandedPaths, [path]: expanded },
        })),
      setFileContents: (path, contents) =>
        set((s) => ({
          fileContents: { ...s.fileContents, [path]: contents },
        })),
      setFileDirty: (path, dirty) =>
        set((s) => ({
          fileDirty: { ...s.fileDirty, [path]: dirty },
        })),
      updateFileContents: (path, contents) =>
        set((s) => ({
          fileContents: { ...s.fileContents, [path]: contents },
        })),
      showContextMenu: (menu) => set({ contextMenu: menu }),
      hideContextMenu: () => set({ contextMenu: null, renameTarget: null }),
      setRenameTarget: (path) => set({ renameTarget: path }),
      triggerRefresh: () => set((s) => ({ refreshCounter: s.refreshCounter + 1 })),
    }),
    {
      name: "t3-file-explorer",
      partialize: (state) => ({
        expandedPaths: state.expandedPaths,
      }),
    },
  ),
);
