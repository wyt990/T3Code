import type { ResolvedKeybindingsConfig, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { Thread } from "../../types";
import { BranchToolbar } from "../BranchToolbar";
import { ChatHeader } from "../chat/ChatHeader";
import { ChatComposer, type ChatComposerHandle } from "../chat/ChatComposer";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { MessagesTimeline } from "../chat/MessagesTimeline";
import { ProviderStatusBanner } from "../chat/ProviderStatusBanner";
import { ThreadErrorBanner } from "../chat/ThreadErrorBanner";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import type { TerminalContextSelection } from "../../lib/terminalContext";
import PlanSidebar from "../PlanSidebar";
import { PullRequestThreadDialog } from "../PullRequestThreadDialog";
import {
  ChatViewPersistentTerminalDrawer,
  type PersistentTerminalLaunchContext,
} from "./ChatViewPersistentTerminalDrawer";
import { chatViewHeaderShellClassName } from "./chatViewHeaderChrome";

type ChatHeaderProps = ComponentProps<typeof ChatHeader>;
type MessagesTimelineProps = ComponentProps<typeof MessagesTimeline>;
type ChatComposerProps = ComponentProps<typeof ChatComposer>;
type BranchToolbarProps = ComponentProps<typeof BranchToolbar>;
type PullRequestThreadDialogProps = ComponentProps<typeof PullRequestThreadDialog>;
type PlanSidebarProps = ComponentProps<typeof PlanSidebar>;

function LoadedPullRequestSlot(props: PullRequestThreadDialogProps & { dialogKey: number }) {
  const { dialogKey, ...rest } = props;
  return <PullRequestThreadDialog key={dialogKey} {...rest} />;
}

export type ChatViewLoadedTerminalMountProps = {
  mountedTerminalThreadRefs: ReadonlyArray<{ key: string; threadRef: ScopedThreadRef }>;
  activeThreadKey: string | null;
  terminalOpen: boolean;
  activeTerminalLaunchContext: PersistentTerminalLaunchContext | null;
  terminalFocusRequestId: number;
  splitTerminalShortcutLabel: string | undefined;
  newTerminalShortcutLabel: string | undefined;
  closeTerminalShortcutLabel: string | undefined;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
};

function ChatViewScrollToBottomPill(props: {
  readonly visible: boolean;
  readonly onClick: () => void;
}) {
  if (!props.visible) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5">
      <button
        type="button"
        onClick={props.onClick}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-muted-foreground text-xs shadow-sm transition-colors hover:border-border hover:text-foreground hover:cursor-pointer"
      >
        <ChevronDownIcon className="size-3.5" />
        滚动到底部
      </button>
    </div>
  );
}

function ChatViewMountedTerminalDrawers(props: ChatViewLoadedTerminalMountProps) {
  return props.mountedTerminalThreadRefs.map(
    ({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
      <ChatViewPersistentTerminalDrawer
        key={mountedThreadKey}
        threadRef={mountedThreadRef}
        threadId={mountedThreadRef.threadId}
        visible={mountedThreadKey === props.activeThreadKey && props.terminalOpen}
        launchContext={
          mountedThreadKey === props.activeThreadKey
            ? (props.activeTerminalLaunchContext ?? null)
            : null
        }
        focusRequestId={
          mountedThreadKey === props.activeThreadKey ? props.terminalFocusRequestId : 0
        }
        splitShortcutLabel={props.splitTerminalShortcutLabel ?? undefined}
        newShortcutLabel={props.newTerminalShortcutLabel ?? undefined}
        closeShortcutLabel={props.closeTerminalShortcutLabel ?? undefined}
        keybindings={props.keybindings}
        onAddTerminalContext={props.onAddTerminalContext}
      />
    ),
  );
}

export type ChatViewLoadedLayoutProps = {
  chatViewRootRef: React.RefObject<HTMLDivElement | null>;
  reserveTitleBarControlInset: boolean;
  chatHeader: ChatHeaderProps;
  providerStatus: ComponentProps<typeof ProviderStatusBanner>["status"];
  threadError: Thread["error"];
  onDismissThreadError: () => void;
  messagesTimelineKey: ThreadId;
  messagesTimeline: MessagesTimelineProps;
  showScrollToBottom: boolean;
  onScrollToBottomClick: () => void;
  composerRef: React.RefObject<ChatComposerHandle | null>;
  chatComposer: ChatComposerProps;
  gitRepoLayoutPadding: boolean;
  branchToolbar: BranchToolbarProps | null;
  pullRequestDialog: (PullRequestThreadDialogProps & { dialogKey: number }) | null;
  planSidebar: PlanSidebarProps | null;
  terminalMount: ChatViewLoadedTerminalMountProps;
  expandedImage: ExpandedImagePreview | null;
  onCloseExpandedImage: () => void;
};

/** Rich chat chrome once `activeThread` is resolved — keeps `ChatViewBody` free of deep JSX. */
export function ChatViewLoadedLayout(props: ChatViewLoadedLayoutProps) {
  return (
    <div
      ref={props.chatViewRootRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background"
    >
      <header className={chatViewHeaderShellClassName(props.reserveTitleBarControlInset)}>
        <ChatHeader {...props.chatHeader} />
      </header>

      <ProviderStatusBanner status={props.providerStatus} />
      <ThreadErrorBanner error={props.threadError} onDismiss={props.onDismissThreadError} />

      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MessagesTimeline key={props.messagesTimelineKey} {...props.messagesTimeline} />
            <ChatViewScrollToBottomPill
              visible={props.showScrollToBottom}
              onClick={props.onScrollToBottomClick}
            />
          </div>

          <div
            className={cn(
              "px-3 pt-1.5 sm:px-5 sm:pt-2",
              props.gitRepoLayoutPadding ? "pb-1" : "pb-3 sm:pb-4",
            )}
          >
            <ChatComposer ref={props.composerRef} {...props.chatComposer} />
          </div>

          {props.branchToolbar ? <BranchToolbar {...props.branchToolbar} /> : null}
          {props.pullRequestDialog ? <LoadedPullRequestSlot {...props.pullRequestDialog} /> : null}
        </div>

        {props.planSidebar ? <PlanSidebar {...props.planSidebar} /> : null}
      </div>

      <ChatViewMountedTerminalDrawers {...props.terminalMount} />

      {props.expandedImage ? (
        <ExpandedImageDialog preview={props.expandedImage} onClose={props.onCloseExpandedImage} />
      ) : null}
    </div>
  );
}
