import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { memo, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import {
  Brain,
  DiffIcon,
  FolderTree,
  ServerIcon,
  TerminalSquareIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { useLayoutStore } from "../../layout/layoutStore";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  const {
    contextShow,
    contextOpen,
    environmentShow,
    environmentOpen,
    multiAgentShow,
    multiAgentOpen,
    fileExplorerShow,
    fileExplorerOpen,
  } = useLayoutStore(
    useShallow((s) => {
      const ctx = s.panels.find((p) => p.id === "context");
      const env = s.panels.find((p) => p.id === "environment");
      const ma = s.panels.find((p) => p.id === "multiAgent");
      const fe = s.panels.find((p) => p.id === "fileExplorer");
      return {
        contextShow: ctx?.visible === true,
        contextOpen: ctx ? ctx.railDocked !== false : false,
        environmentShow: env?.visible === true,
        environmentOpen: env ? env.railDocked !== false : false,
        multiAgentShow: ma?.visible === true,
        multiAgentOpen: ma ? ma.railDocked !== false : false,
        fileExplorerShow: fe?.visible === true,
        fileExplorerOpen: fe ? fe.railDocked !== false : false,
      };
    }),
  );

  const onToggleContextRail = useCallback((nextPressed: boolean) => {
    useLayoutStore.getState().updatePanel("context", { railDocked: nextPressed });
  }, []);

  const onToggleEnvironmentRail = useCallback((nextPressed: boolean) => {
    useLayoutStore.getState().updatePanel("environment", { railDocked: nextPressed });
  }, []);

  const onToggleMultiAgentRail = useCallback((nextPressed: boolean) => {
    useLayoutStore.getState().updatePanel("multiAgent", { railDocked: nextPressed });
  }, []);

  const onToggleFileExplorerRail = useCallback((nextPressed: boolean) => {
    useLayoutStore.getState().updatePanel("fileExplorer", { railDocked: nextPressed });
  }, []);

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="切换终端抽屉"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "终端不可用，直到此线程有活动项目。"
              : terminalToggleShortcutLabel
                ? `切换终端抽屉 (${terminalToggleShortcutLabel})`
                : "切换终端抽屉"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="切换 diff 面板"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "diff 面板不可用，因为此项目不是 git 仓库。"
              : diffToggleShortcutLabel
                ? `切换 diff 面板 (${diffToggleShortcutLabel})`
                : "切换 diff 面板"}
          </TooltipPopup>
        </Tooltip>
        {contextShow && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={contextOpen}
                  onPressedChange={onToggleContextRail}
                  aria-label="切换智能上下文侧栏"
                  variant="outline"
                  size="xs"
                >
                  <Brain className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {contextOpen
                ? "隐藏智能上下文侧栏（布局中的「上下文」仍控制是否显示此按钮）"
                : "显示智能上下文侧栏"}
            </TooltipPopup>
          </Tooltip>
        )}
        {environmentShow && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={environmentOpen}
                  onPressedChange={onToggleEnvironmentRail}
                  aria-label="切换环境管理侧栏"
                  variant="outline"
                  size="xs"
                >
                  <ServerIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {environmentOpen
                ? "隐藏环境管理侧栏（布局中的「环境」仍控制是否显示此按钮）"
                : "显示环境管理侧栏"}
            </TooltipPopup>
          </Tooltip>
        )}
        {multiAgentShow && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={multiAgentOpen}
                  onPressedChange={onToggleMultiAgentRail}
                  aria-label="切换多代理侧栏"
                  variant="outline"
                  size="xs"
                >
                  <UsersRoundIcon className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {multiAgentOpen
                ? "隐藏多代理侧栏（布局中的「多代理」仍控制是否显示此按钮）"
                : "显示多代理侧栏"}
            </TooltipPopup>
          </Tooltip>
        )}
        {fileExplorerShow && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="shrink-0"
                  pressed={fileExplorerOpen}
                  onPressedChange={onToggleFileExplorerRail}
                  aria-label="切换文件浏览侧栏"
                  variant="outline"
                  size="xs"
                >
                  <FolderTree className="size-3" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {fileExplorerOpen
                ? "隐藏文件浏览侧栏（布局中的「文件」仍控制是否显示此按钮）"
                : "显示文件浏览侧栏"}
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
    </div>
  );
});
