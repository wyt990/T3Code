import { useRef, useEffect, useState } from "react";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { cn } from "~/lib/utils";

interface FileTreeNodeProps {
  readonly name: string;
  readonly fullPath: string;
  readonly type: "file" | "directory" | "symlink" | "other";
  readonly depth: number;
  readonly isExpanded: boolean;
  readonly isSelected: boolean;
  readonly isContextMenuTarget: boolean;
  readonly onToggle: (path: string) => void;
  readonly onSelect: (path: string) => void;
  readonly onContextMenu: (
    e: React.MouseEvent,
    path: string,
    type: "file" | "directory" | "symlink" | "other",
  ) => void;
  readonly isRenaming: boolean;
  readonly onRenameSubmit: (newName: string) => void;
  readonly onRenameCancel: () => void;
}

export function FileTreeNode({
  name,
  fullPath,
  type,
  depth,
  isExpanded,
  isSelected,
  isContextMenuTarget,
  onToggle,
  onSelect,
  onContextMenu,
  isRenaming,
  onRenameSubmit,
  onRenameCancel,
}: FileTreeNodeProps) {
  const isDirectory = type === "directory";
  const [renameValue, setRenameValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      setRenameValue(name);
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming, name]);

  const handleClick = () => {
    if (isRenaming) return;
    if (isDirectory) {
      onToggle(fullPath);
    } else {
      onSelect(fullPath);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isRenaming) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, fullPath, type);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onRenameSubmit(renameValue);
    } else if (e.key === "Escape") {
      onRenameCancel();
    }
  };

  return (
    <div
      className={cn(
        "file-tree-item flex items-center gap-1 px-2 py-0.5 text-sm cursor-pointer select-none",
        !isContextMenuTarget && "hover:bg-white/5",
        "rounded-sm",
        isSelected && "bg-accent/10 text-accent",
        isContextMenuTarget && "bg-foreground/15",
      )}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {isDirectory ? (
        <span className="w-4 text-center text-muted-foreground text-xs shrink-0">
          {isExpanded ? "▾" : "▸"}
        </span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <VscodeEntryIcon
        pathValue={fullPath}
        kind={isDirectory ? "directory" : "file"}
        theme="dark"
        className="size-4 shrink-0"
      />
      {isRenaming ? (
        <input
          ref={inputRef}
          className="flex-1 min-w-0 bg-white/10 border border-accent rounded px-1 py-0 text-xs outline-none"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={() => onRenameSubmit(renameValue)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate">{name}</span>
      )}
    </div>
  );
}
