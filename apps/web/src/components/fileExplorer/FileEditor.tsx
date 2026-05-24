import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { openSearchPanel, closeSearchPanel } from "@codemirror/search";
import { undo, redo, indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import {
  ArrowDownToLine,
  Check,
  Circle,
  Eye,
  FileIcon,
  Pencil,
  Redo2,
  Save,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { useFileExplorerStore } from "./fileExplorerStore";
import { readEnvironmentApi } from "../../environmentApi";
import { cn } from "~/lib/utils";
import type { EnvironmentId } from "@t3tools/contracts";

// ── Language detection ──

const EXT_BY_EXT: Record<string, () => Extension | null> = {
  ".ts": () => javascript(),
  ".tsx": () => javascript({ jsx: true, typescript: true }),
  ".js": () => javascript(),
  ".jsx": () => javascript({ jsx: true }),
  ".mjs": () => javascript(),
  ".cjs": () => javascript(),
  ".json": () => json(),
  ".md": () => markdown(),
  ".css": () => css(),
  ".html": () => html(),
  ".htm": () => html(),
  ".py": () => python(),
  ".rs": () => rust(),
  ".go": () => go(),
  ".xml": () => xml(),
  ".svg": () => xml(),
  ".yaml": () => yaml(),
  ".yml": () => yaml(),
  ".sql": () => sql({}),
  ".sh": () => StreamLanguage.define(shell),
  ".bash": () => StreamLanguage.define(shell),
  ".zsh": () => StreamLanguage.define(shell),
};

function detectLanguage(fileName: string): Extension | null {
  const ext = fileName.substring(fileName.lastIndexOf("."));
  const factory = EXT_BY_EXT[ext];
  if (factory) return factory();
  const lower = fileName.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith("/dockerfile")) {
    return StreamLanguage.define(dockerFile);
  }
  return null;
}

function detectLanguageName(fileName: string): string {
  const ext = fileName.substring(fileName.lastIndexOf("."));
  const names: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript React",
    ".js": "JavaScript",
    ".jsx": "JavaScript React",
    ".mjs": "JavaScript ES",
    ".cjs": "JavaScript CJS",
    ".json": "JSON",
    ".md": "Markdown",
    ".css": "CSS",
    ".html": "HTML",
    ".py": "Python",
    ".rs": "Rust",
    ".go": "Go",
    ".xml": "XML",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".sql": "SQL",
    ".sh": "Shell",
    ".bash": "Shell",
    ".zsh": "Shell",
  };
  return names[ext] ?? "Plain Text";
}

// ── Component ──

interface FileEditorProps {
  readonly filePath: string;
  readonly workspaceRoot: string;
  readonly environmentId: EnvironmentId;
  readonly className?: string;
}

export function FileEditor({ filePath, workspaceRoot, environmentId, className }: FileEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableCompRef = useRef(new Compartment());
  const isEditingRef = useRef(false);

  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [showGotoLine, setShowGotoLine] = useState(false);
  const [gotoValue, setGotoValue] = useState("");

  const fileContents = useFileExplorerStore((s) => s.fileContents[filePath]);
  const fileDirty = useFileExplorerStore((s) => s.fileDirty[filePath] ?? false);
  const setFileContents = useFileExplorerStore((s) => s.setFileContents);
  const updateFileContents = useFileExplorerStore((s) => s.updateFileContents);
  const setFileDirty = useFileExplorerStore((s) => s.setFileDirty);

  const fileName = filePath.split("/").pop() ?? filePath;
  const langName = detectLanguageName(fileName);

  // ── Load file content ──
  useEffect(() => {
    if (!fileContents) {
      setLoading(true);
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        setLoading(false);
        return;
      }
      api.projects
        .readFile({ cwd: workspaceRoot, relativePath: filePath })
        .then((result) => {
          setFileContents(filePath, result.contents);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [filePath, workspaceRoot, environmentId, fileContents, setFileContents]);

  // ── Create editor (only on filePath change / initial load) ──
  useEffect(() => {
    if (loading || !editorRef.current || fileContents === undefined) return;

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const langExt = detectLanguage(fileName);
    const isLargeFile = fileContents.length > 1024 * 1024;

    const state = EditorState.create({
      doc: fileContents,
      extensions: [
        basicSetup,
        oneDark,
        keymap.of([indentWithTab]),
        ...(isLargeFile || langExt === null ? [] : [langExt]),
        editableCompRef.current.of(EditorView.editable.of(false)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && isEditingRef.current) {
            updateFileContents(filePath, update.state.doc.toString());
            setFileDirty(filePath, true);
          }
          if (update.selectionSet) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            setCursorLine(line.number);
            setCursorCol(pos - line.from + 1);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    isEditingRef.current = false;
    setIsEditing(false);

    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    setCursorLine(line.number);
    setCursorCol(pos - line.from + 1);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only recreate when file changes or content first loads — NOT when isEditing toggles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, loading]);

  // ── Toggle editing (no editor rebuild) ──
  const toggleEditing = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = !isEditingRef.current;
    isEditingRef.current = next;
    setIsEditing(next);
    view.dispatch({
      effects: editableCompRef.current.reconfigure(EditorView.editable.of(next)),
    });
  }, []);

  // ── Save ──
  const handleSave = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    const currentContents = viewRef.current?.state.doc.toString() ?? "";
    if (!currentContents) return;
    await api.projects.writeFile({
      cwd: workspaceRoot,
      relativePath: filePath,
      contents: currentContents,
    });
    setFileDirty(filePath, false);
  }, [environmentId, workspaceRoot, filePath, setFileDirty]);

  // ── Keyboard shortcuts (Ctrl+S save) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isEditingRef.current) handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // ── Search ──
  const toggleSearch = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const searchOpen = view.dom.querySelector(".cm-search") !== null;
    if (searchOpen) {
      closeSearchPanel(view);
    } else {
      openSearchPanel(view);
    }
  }, []);

  // ── Go to line ──
  const openGotoLine = useCallback(() => {
    setGotoValue("");
    setShowGotoLine(true);
  }, []);

  const confirmGotoLine = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const line = parseInt(gotoValue, 10);
    if (!Number.isFinite(line) || line < 1) return;
    const doc = view.state.doc;
    const targetLine = Math.min(line, doc.lines);
    const pos = doc.line(targetLine).from;
    view.dispatch({
      selection: { anchor: pos, head: pos },
      scrollIntoView: true,
    });
    view.focus();
    setShowGotoLine(false);
  }, [gotoValue]);

  const handleGotoKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") confirmGotoLine();
      if (e.key === "Escape") setShowGotoLine(false);
    },
    [confirmGotoLine],
  );

  // ── Undo / Redo ──
  const handleUndo = useCallback(() => {
    viewRef.current && undo(viewRef.current);
  }, []);
  const handleRedo = useCallback(() => {
    viewRef.current && redo(viewRef.current);
  }, []);

  // ── Click editor to enter edit mode ──
  const handleEditorClick = useCallback(() => {
    if (!isEditingRef.current) {
      toggleEditing();
    }
  }, [toggleEditing]);

  // ── Toolbar button style ──
  const btnClass =
    "flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        加载中...
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-0.5 px-2 py-0.5 border-b border-border shrink-0 bg-background select-none">
        <FileIcon className="size-3.5 text-muted-foreground shrink-0 ml-0.5" aria-hidden />
        <span
          className="text-xs font-medium truncate max-w-[220px] mr-1"
          title={filePath}
        >
          {fileName}
        </span>
        {fileDirty && (
          <Circle
            className="size-2 fill-current text-accent shrink-0"
            aria-label="文件已修改"
          />
        )}

        <div className="flex-1" />

        {isEditing && (
          <>
            <button
              type="button"
              className={btnClass}
              title="撤销 (Ctrl+Z)"
              onClick={handleUndo}
            >
              <Undo2 className="size-3.5" />
            </button>
            <button
              type="button"
              className={btnClass}
              title="重做 (Ctrl+Shift+Z)"
              onClick={handleRedo}
            >
              <Redo2 className="size-3.5" />
            </button>
            <button
              type="button"
              className={cn(btnClass, "text-accent hover:text-accent")}
              title="保存 (Ctrl+S)"
              onClick={handleSave}
            >
              <Save className="size-3.5" />
            </button>
          </>
        )}

        <button
          type="button"
          className={btnClass}
          title="查找 / 替换 (Ctrl+F)"
          onClick={toggleSearch}
        >
          <Search className="size-3.5" />
        </button>

        {isEditing && (
          <button
            type="button"
            className={btnClass}
            title="跳转到行"
            onClick={openGotoLine}
          >
            <ArrowDownToLine className="size-3.5" />
          </button>
        )}

        <div className="w-px h-4 bg-border mx-0.5" aria-hidden />

        <button
          type="button"
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
            isEditing
              ? "hover:bg-muted text-muted-foreground hover:text-foreground"
              : "text-accent hover:bg-accent/10",
          )}
          onClick={toggleEditing}
          title={isEditing ? "切换到只读模式" : "编辑文件"}
        >
          {isEditing ? (
            <>
              <Eye className="size-3.5" />
              <span className="hidden sm:inline">只读</span>
            </>
          ) : (
            <>
              <Pencil className="size-3.5" />
              <span className="hidden sm:inline">编辑</span>
            </>
          )}
        </button>
      </div>

      {/* ── Go-to-line popup ── */}
      {showGotoLine && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-border shrink-0 bg-background text-xs">
          <span className="text-muted-foreground">跳转到行:</span>
          <input
            ref={(el) => el?.focus()}
            type="number"
            min={1}
            className="w-16 bg-white/10 border border-border rounded px-1.5 py-0.5 outline-none focus:border-accent"
            value={gotoValue}
            onChange={(e) => setGotoValue(e.target.value)}
            onKeyDown={handleGotoKey}
          />
          <button
            type="button"
            className={cn(btnClass, "text-xs")}
            onClick={confirmGotoLine}
            title="确认"
          >
            <Check className="size-3" />
          </button>
          <button
            type="button"
            className={btnClass}
            onClick={() => setShowGotoLine(false)}
            title="取消"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* ── Editor ── */}
      <div
        ref={editorRef}
        className="flex-1 overflow-auto"
        onClick={handleEditorClick}
      />

      {/* ── Status bar ── */}
      <div className="flex items-center gap-3 px-3 py-0.5 border-t border-border shrink-0 text-[11px] text-muted-foreground bg-background select-none">
        <span>
          行 {cursorLine}, 列 {cursorCol}
        </span>
        <span className="text-border select-none">|</span>
        <span>{langName}</span>
        <span className="text-border select-none">|</span>
        <span>UTF-8</span>
        <div className="flex-1" />
        {fileDirty && <span className="text-accent">已修改</span>}
      </div>
    </div>
  );
}
