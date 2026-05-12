import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CommandPaletteOpenIntent {
  kind: "add-project";
  requestId: number;
}

export interface CommandItem {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  shortcut?: string;
  keywords: string[];
  category: string;
  action: () => void;
  context?: {
    fileTypes?: string[];
    modes?: string[];
  };
}

export interface CommandHistory {
  commandId: string;
  timestamp: string;
  count: number;
}

export interface NaturalLanguageQuery {
  id: string;
  query: string;
  parsedCommand?: string;
  executedAt: string;
}

interface CommandPaletteStore {
  open: boolean;
  openIntent: CommandPaletteOpenIntent | null;
  query: string;
  selectedIndex: number;
  commands: CommandItem[];
  history: CommandHistory[];
  suggestions: CommandItem[];
  recentQueries: NaturalLanguageQuery[];
  contextAwareSuggestions: CommandItem[];

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  openAddProject: () => void;
  clearOpenIntent: () => void;
  setQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  registerCommand: (command: CommandItem) => void;
  unregisterCommand: (commandId: string) => void;
  addToHistory: (commandId: string) => void;
  getSuggestions: (context: { currentFile?: string; mode?: string }) => CommandItem[];
  executeCommand: (commandId: string) => void;
  // Natural language query support
  addRecentQuery: (query: string, parsedCommand?: string) => void;
  getRecentQueries: () => NaturalLanguageQuery[];
  // Context-aware suggestions
  updateContextAwareSuggestions: (context: CommandContext) => void;
  getContextAwareSuggestions: () => CommandItem[];
}

export interface CommandContext {
  currentFile?: string;
  currentMode?: string;
  recentFiles?: string[];
  selectedText?: string;
  cursorPosition?: { line: number; column: number };
}

// Parse natural language query to find matching commands
export function parseNaturalLanguage(query: string, commands: CommandItem[]): CommandItem[] {
  const normalizedQuery = query.toLowerCase().trim();
  const results: CommandItem[] = [];

  // Common natural language patterns
  const patterns: Record<string, string[]> = {
    "new-thread": [
      "新对话",
      "新建对话",
      "开始对话",
      "开个对话",
      "new chat",
      "start chat",
      "create thread",
    ],
    "add-project": [
      "添加项目",
      "打开项目",
      "打开文件夹",
      "add project",
      "open folder",
      "open project",
    ],
    settings: ["设置", "偏好设置", "配置", "打开设置", "settings", "preferences", "config"],
    "close-tab": ["关闭标签", "关闭当前标签", "close tab", "close current tab"],
    "merge-tabs": ["合并标签", "与右侧合并", "向右合并", "merge tabs", "combine tabs"],
    "split-tabs": ["分离标签", "拆分标签", "取消合并", "split tabs", "unmerge tabs"],
    "smart-context": [
      "帮我处理所有 todo",
      "处理 todo",
      "处理待办",
      "todo 列表",
      "待办事项",
      "fixme",
      "智能上下文",
      "上下文分析",
      "变更影响",
      "依赖分析",
    ],
  };

  for (const command of commands) {
    const commandPatterns = patterns[command.id] || [];
    for (const pattern of commandPatterns) {
      if (normalizedQuery.includes(pattern.toLowerCase())) {
        results.push(command);
        break;
      }
    }
  }

  // Also check keywords
  for (const command of commands) {
    if (results.includes(command)) continue;
    for (const keyword of command.keywords) {
      if (normalizedQuery.includes(keyword.toLowerCase())) {
        results.push(command);
        break;
      }
    }
  }

  return results;
}

export const useCommandPaletteStore = create<CommandPaletteStore>()(
  persist(
    (set, get) => ({
      open: false,
      openIntent: null,
      query: "",
      selectedIndex: 0,
      commands: [],
      history: [],
      suggestions: [],
      recentQueries: [],
      contextAwareSuggestions: [],

      setOpen: (open) => set({ open, ...(open ? {} : { openIntent: null }) }),
      toggleOpen: () =>
        set((state) => ({ open: !state.open, ...(state.open ? { openIntent: null } : {}) })),
      openAddProject: () =>
        set((state) => ({
          open: true,
          openIntent: {
            kind: "add-project",
            requestId: (state.openIntent?.requestId ?? 0) + 1,
          },
        })),
      clearOpenIntent: () => set({ openIntent: null }),
      setQuery: (query) => set({ query, selectedIndex: 0 }),
      setSelectedIndex: (index) => set({ selectedIndex: index }),

      registerCommand: (command) => {
        set((state) => ({
          commands: [...state.commands.filter((c) => c.id !== command.id), command],
        }));
      },

      unregisterCommand: (commandId) => {
        set((state) => ({
          commands: state.commands.filter((c) => c.id !== commandId),
        }));
      },

      addToHistory: (commandId) => {
        set((state) => {
          const existing = state.history.find((h) => h.commandId === commandId);
          if (existing) {
            return {
              history: state.history.map((h) =>
                h.commandId === commandId
                  ? { ...h, count: h.count + 1, timestamp: new Date().toISOString() }
                  : h,
              ),
            };
          }
          return {
            history: [
              ...state.history,
              { commandId, timestamp: new Date().toISOString(), count: 1 },
            ],
          };
        });
      },

      getSuggestions: (context) => {
        const { commands, history } = get();
        const scoredCommands = commands.map((cmd) => {
          let score = 0;
          const historyEntry = history.find((h) => h.commandId === cmd.id);

          // Boost by usage frequency
          if (historyEntry) {
            score += historyEntry.count * 10;
          }

          // Boost by context relevance
          if (context.currentFile && cmd.context?.fileTypes) {
            const fileExt = context.currentFile.split(".").pop();
            if (fileExt && cmd.context.fileTypes.includes(fileExt)) {
              score += 50;
            }
          }

          if (context.mode && cmd.context?.modes?.includes(context.mode)) {
            score += 30;
          }

          return { command: cmd, score };
        });

        return scoredCommands.sort((a, b) => b.score - a.score).map((s) => s.command);
      },

      executeCommand: (commandId) => {
        const command = get().commands.find((c) => c.id === commandId);
        if (command) {
          get().addToHistory(commandId);
          command.action();
        }
      },

      // Natural language query support
      addRecentQuery: (query, parsedCommand) => {
        set((state) => {
          const newQuery: NaturalLanguageQuery = parsedCommand
            ? {
                id: `query-${Date.now()}`,
                query,
                parsedCommand,
                executedAt: new Date().toISOString(),
              }
            : { id: `query-${Date.now()}`, query, executedAt: new Date().toISOString() };
          // Keep only last 20 queries
          const recentQueries = [newQuery, ...state.recentQueries].slice(0, 20);
          return { recentQueries };
        });
      },

      getRecentQueries: () => {
        return get().recentQueries.slice(0, 10);
      },

      // Context-aware suggestions
      updateContextAwareSuggestions: (context) => {
        const { commands } = get();
        const suggestions: CommandItem[] = [];

        // File-specific suggestions
        if (context.currentFile) {
          const fileExt = context.currentFile.split(".").pop();
          if (fileExt) {
            const fileCommands = commands.filter((c) => c.context?.fileTypes?.includes(fileExt));
            suggestions.push(...fileCommands);
          }
        }

        // Mode-specific suggestions
        if (context.currentMode) {
          const modeCommands = commands.filter((c) =>
            c.context?.modes?.includes(context.currentMode!),
          );
          suggestions.push(...modeCommands);
        }

        // Recent file suggestions
        if (context.recentFiles && context.recentFiles.length > 0) {
          // Could add file-related commands here
        }

        set({ contextAwareSuggestions: suggestions.slice(0, 5) });
      },

      getContextAwareSuggestions: () => {
        return get().contextAwareSuggestions;
      },
    }),
    {
      name: "t3-command-palette",
      partialize: (state) => ({
        history: state.history,
        recentQueries: state.recentQueries,
      }),
    },
  ),
);
