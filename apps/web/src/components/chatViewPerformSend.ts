import type { LegendListRef } from "@legendapp/list/react";
import { createModelSelection } from "@t3tools/shared/model";
import { truncate } from "@t3tools/shared/String";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ProviderInteractionMode,
  RuntimeMode,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import {
  collapseExpandedComposerCursor,
  parseStandaloneComposerSlashCommand,
} from "../composer-logic";
import type { ComposerImageAttachment, DraftId, DraftThreadEnvMode } from "../composerDraftStore";
import { readEnvironmentApi } from "../environmentApi";
import { appendTerminalContextsToPrompt, formatTerminalContextLabel } from "../lib/terminalContext";
import { newCommandId, newMessageId } from "~/lib/utils";
import { resolvePlanFollowUpSubmission } from "../proposedPlan";
import type { ChatMessage, Project, Thread } from "../types";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import {
  buildExpiredTerminalContextToastCopy,
  cloneComposerImageForRetry,
  deriveComposerSendState,
  formatOutgoingPrompt,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  readFileAsDataUrl,
  revokeUserMessagePreviewUrls,
} from "./ChatView.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";
import type { TerminalContextDraft } from "../lib/terminalContext";

export type ComposerDraftRouteTarget = ScopedThreadRef | DraftId;

export interface ScrollToBottomDebouncerHandle {
  cancel: () => void;
  maybeExecute: () => void;
}

export interface PerformChatViewSendDeps {
  e?: { preventDefault: () => void };
  environmentId: ScopedThreadRef["environmentId"];
  activeThread: Thread;
  activeProject: Project | null | undefined;
  isSendBusy: boolean;
  isConnecting: boolean;
  sendInFlightRef: MutableRefObject<boolean>;
  activePendingProgress: unknown | null;
  onAdvanceActivePendingUserInput: () => void;
  composerRef: MutableRefObject<ChatComposerHandle | null>;
  promptRef: MutableRefObject<string>;
  composerImagesRef: MutableRefObject<ComposerImageAttachment[]>;
  composerTerminalContextsRef: MutableRefObject<TerminalContextDraft[]>;
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: Thread["proposedPlans"][number] | null;
  onSubmitPlanFollowUp: (input: {
    text: string;
    interactionMode: "default" | "plan";
  }) => Promise<void>;
  composerDraftTarget: ComposerDraftRouteTarget;
  clearComposerDraftContent: (target: ComposerDraftRouteTarget) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;
  isServerThread: boolean;
  sendEnvMode: DraftThreadEnvMode;
  activeThreadBranch: string | null;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
  beginLocalDispatch: (input: { preparingWorktree: boolean }) => void;
  resetLocalDispatch: () => void;
  isAtEndRef: MutableRefObject<boolean>;
  showScrollDebouncer: MutableRefObject<ScrollToBottomDebouncerHandle>;
  setShowScrollToBottom: (value: boolean) => void;
  legendListRef: MutableRefObject<LegendListRef | null>;
  setOptimisticUserMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  persistThreadSettingsForNextTurn: (input: {
    threadId: ThreadId;
    createdAt: string;
    modelSelection?: ModelSelection;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
  }) => Promise<void>;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  isLocalDraftThread: boolean;
  setComposerDraftPrompt: (target: ComposerDraftRouteTarget, prompt: string) => void;
  addComposerDraftImages: (
    target: ComposerDraftRouteTarget,
    images: ComposerImageAttachment[],
  ) => void;
  setComposerDraftTerminalContexts: (
    target: ComposerDraftRouteTarget,
    contexts: TerminalContextDraft[],
  ) => void;
}

/** Sends the composer message / advances pending input — extracted to keep `ChatView` cognitive complexity low. */
export async function performChatViewSend(deps: PerformChatViewSendDeps): Promise<void> {
  deps.e?.preventDefault();
  const api = readEnvironmentApi(deps.environmentId);
  if (
    !api ||
    !deps.activeThread ||
    deps.isSendBusy ||
    deps.isConnecting ||
    deps.sendInFlightRef.current
  ) {
    return;
  }
  if (deps.activePendingProgress) {
    deps.onAdvanceActivePendingUserInput();
    return;
  }
  const sendCtx = deps.composerRef.current?.getSendContext();
  if (!sendCtx) return;
  const {
    images: composerImages,
    terminalContexts: composerTerminalContexts,
    selectedProvider: ctxSelectedProvider,
    selectedModel: ctxSelectedModel,
    selectedProviderModels: ctxSelectedProviderModels,
    selectedPromptEffort: ctxSelectedPromptEffort,
    selectedModelSelection: ctxSelectedModelSelection,
  } = sendCtx;
  const promptForSend = deps.promptRef.current;
  const {
    trimmedPrompt: trimmed,
    sendableTerminalContexts: sendableComposerTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent,
  } = deriveComposerSendState({
    prompt: promptForSend,
    imageCount: composerImages.length,
    terminalContexts: composerTerminalContexts,
  });
  if (deps.showPlanFollowUpPrompt && deps.activeProposedPlan) {
    const followUp = resolvePlanFollowUpSubmission({
      draftText: trimmed,
      planMarkdown: deps.activeProposedPlan.planMarkdown,
    });
    deps.promptRef.current = "";
    deps.clearComposerDraftContent(deps.composerDraftTarget);
    deps.composerRef.current?.resetCursorState();
    await deps.onSubmitPlanFollowUp({
      text: followUp.text,
      interactionMode: followUp.interactionMode,
    });
    return;
  }
  const standaloneSlashCommand =
    composerImages.length === 0 && sendableComposerTerminalContexts.length === 0
      ? parseStandaloneComposerSlashCommand(trimmed)
      : null;
  if (standaloneSlashCommand) {
    deps.handleInteractionModeChange(standaloneSlashCommand);
    deps.promptRef.current = "";
    deps.clearComposerDraftContent(deps.composerDraftTarget);
    deps.composerRef.current?.resetCursorState();
    return;
  }
  if (!hasSendableContent) {
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(expiredTerminalContextCount, "empty");
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        }),
      );
    }
    return;
  }
  if (!deps.activeProject) return;
  const activeProject = deps.activeProject;
  const threadIdForSend = deps.activeThread.id;
  const isFirstMessage = !deps.isServerThread || deps.activeThread.messages.length === 0;
  const baseBranchForWorktree =
    isFirstMessage && deps.sendEnvMode === "worktree" && !deps.activeThread.worktreePath
      ? deps.activeThreadBranch
      : null;

  const shouldCreateWorktree =
    isFirstMessage && deps.sendEnvMode === "worktree" && !deps.activeThread.worktreePath;
  if (shouldCreateWorktree && !deps.activeThreadBranch) {
    deps.setThreadError(threadIdForSend, "在新工作树模式下发送前请选择基础分支。");
    return;
  }

  deps.sendInFlightRef.current = true;
  deps.beginLocalDispatch({ preparingWorktree: Boolean(baseBranchForWorktree) });

  const composerImagesSnapshot = [...composerImages];
  const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
  const messageTextForSend = appendTerminalContextsToPrompt(
    promptForSend,
    composerTerminalContextsSnapshot,
  );
  const messageIdForSend = newMessageId();
  const messageCreatedAt = new Date().toISOString();
  const outgoingMessageText = formatOutgoingPrompt({
    provider: ctxSelectedProvider,
    model: ctxSelectedModel,
    models: ctxSelectedProviderModels,
    effort: ctxSelectedPromptEffort,
    text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
  });
  const turnAttachmentsPromise = Promise.all(
    composerImagesSnapshot.map(async (image) => ({
      type: "image" as const,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: await readFileAsDataUrl(image.file),
    })),
  );
  const optimisticAttachments = composerImagesSnapshot.map((image) => ({
    type: "image" as const,
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    previewUrl: image.previewUrl,
  }));
  deps.isAtEndRef.current = true;
  deps.showScrollDebouncer.current.cancel();
  deps.setShowScrollToBottom(false);
  await deps.legendListRef.current?.scrollToEnd?.({ animated: false });

  deps.setOptimisticUserMessages((existing) => [
    ...existing,
    {
      id: messageIdForSend,
      role: "user",
      text: outgoingMessageText,
      ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
      createdAt: messageCreatedAt,
      streaming: false,
    },
  ]);

  deps.setThreadError(threadIdForSend, null);
  if (expiredTerminalContextCount > 0) {
    const toastCopy = buildExpiredTerminalContextToastCopy(expiredTerminalContextCount, "omitted");
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: toastCopy.title,
        description: toastCopy.description,
      }),
    );
  }
  deps.promptRef.current = "";
  deps.clearComposerDraftContent(deps.composerDraftTarget);
  deps.composerRef.current?.resetCursorState();

  let turnStartSucceeded = false;
  await (async () => {
    let firstComposerImageName: string | null = null;
    if (composerImagesSnapshot.length > 0) {
      const firstComposerImage = composerImagesSnapshot[0];
      if (firstComposerImage) {
        firstComposerImageName = firstComposerImage.name;
      }
    }
    let titleSeed = trimmed;
    if (!titleSeed) {
      if (firstComposerImageName) {
        titleSeed = `图片: ${firstComposerImageName}`;
      } else if (composerTerminalContextsSnapshot.length > 0) {
        titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]!);
      } else {
        titleSeed = "新项目";
      }
    }
    const title = truncate(titleSeed);

    const threadCreateModelSelection = createModelSelection(
      ctxSelectedProvider,
      ctxSelectedModel ||
        activeProject.defaultModelSelection?.model ||
        DEFAULT_MODEL_BY_PROVIDER.codex,
      ctxSelectedModelSelection.options,
    );

    if (isFirstMessage && deps.isServerThread) {
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: threadIdForSend,
        title,
      });
    }

    if (deps.isServerThread) {
      await deps.persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        ...(ctxSelectedModel ? { modelSelection: ctxSelectedModelSelection } : {}),
        runtimeMode: deps.runtimeMode,
        interactionMode: deps.interactionMode,
      });
    }

    const turnAttachments = await turnAttachmentsPromise;
    const bootstrap =
      deps.isLocalDraftThread || baseBranchForWorktree
        ? {
            ...(deps.isLocalDraftThread
              ? {
                  createThread: {
                    projectId: activeProject.id,
                    title,
                    modelSelection: threadCreateModelSelection,
                    runtimeMode: deps.runtimeMode,
                    interactionMode: deps.interactionMode,
                    branch: deps.activeThreadBranch,
                    worktreePath: deps.activeThread.worktreePath,
                    createdAt: deps.activeThread.createdAt,
                  },
                }
              : {}),
            ...(baseBranchForWorktree
              ? {
                  prepareWorktree: {
                    projectCwd: activeProject.cwd,
                    baseBranch: baseBranchForWorktree,
                    branch: buildTemporaryWorktreeBranchName(),
                  },
                  runSetupScript: true,
                }
              : {}),
          }
        : undefined;
    deps.beginLocalDispatch({ preparingWorktree: false });
    await api.orchestration.dispatchCommand({
      type: "thread.turn.start",
      commandId: newCommandId(),
      threadId: threadIdForSend,
      message: {
        messageId: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        attachments: turnAttachments,
      },
      modelSelection: ctxSelectedModelSelection,
      titleSeed: title,
      runtimeMode: deps.runtimeMode,
      interactionMode: deps.interactionMode,
      ...(bootstrap ? { bootstrap } : {}),
      createdAt: messageCreatedAt,
    });
    turnStartSucceeded = true;
  })().catch(async (err: unknown) => {
    if (
      !turnStartSucceeded &&
      deps.promptRef.current.length === 0 &&
      deps.composerImagesRef.current.length === 0 &&
      deps.composerTerminalContextsRef.current.length === 0
    ) {
      deps.setOptimisticUserMessages((existing) => {
        const removed = existing.filter((message) => message.id === messageIdForSend);
        for (const message of removed) {
          revokeUserMessagePreviewUrls(message);
        }
        const next = existing.filter((message) => message.id !== messageIdForSend);
        return next.length === existing.length ? existing : next;
      });
      deps.promptRef.current = promptForSend;
      const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
      deps.composerImagesRef.current = retryComposerImages;
      deps.composerTerminalContextsRef.current = composerTerminalContextsSnapshot;
      deps.setComposerDraftPrompt(deps.composerDraftTarget, promptForSend);
      deps.addComposerDraftImages(deps.composerDraftTarget, retryComposerImages);
      deps.setComposerDraftTerminalContexts(
        deps.composerDraftTarget,
        composerTerminalContextsSnapshot,
      );
      deps.composerRef.current?.resetCursorState({
        cursor: collapseExpandedComposerCursor(promptForSend, promptForSend.length),
        prompt: promptForSend,
        detectTrigger: true,
      });
    }
    deps.setThreadError(threadIdForSend, err instanceof Error ? err.message : "发送消息失败。");
  });
  deps.sendInFlightRef.current = false;
  if (!turnStartSucceeded) {
    deps.resetLocalDispatch();
  }
}
