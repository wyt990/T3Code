export type ChatViewKeyboardShortcutDeps = {
  terminalOpen: boolean;
  activeTerminalId: string;
  toggleTerminalVisibility: () => void;
  setTerminalOpen: (open: boolean) => void;
  splitTerminal: () => void;
  closeTerminal: (terminalId: string) => void;
  createNewTerminal: () => void;
  onToggleDiff: () => void;
  toggleModelPicker: () => void;
};

/** Dispatches chat-global keyboard commands (terminal + diff + model picker). */
export function handleChatViewKeyboardCommand(
  command: string,
  deps: ChatViewKeyboardShortcutDeps,
): boolean {
  switch (command) {
    case "terminal.toggle":
      deps.toggleTerminalVisibility();
      return true;
    case "terminal.split":
      if (!deps.terminalOpen) {
        deps.setTerminalOpen(true);
      }
      deps.splitTerminal();
      return true;
    case "terminal.close":
      if (!deps.terminalOpen) {
        return false;
      }
      deps.closeTerminal(deps.activeTerminalId);
      return true;
    case "terminal.new":
      if (!deps.terminalOpen) {
        deps.setTerminalOpen(true);
      }
      deps.createNewTerminal();
      return true;
    case "diff.toggle":
      deps.onToggleDiff();
      return true;
    case "modelPicker.toggle":
      deps.toggleModelPicker();
      return true;
    default:
      return false;
  }
}
