import type { DraftThreadEnvMode } from "../../composerDraftStore";
import type { Thread } from "../../types";

export function deriveCanOverrideServerThreadEnvMode(input: {
  isServerThread: boolean;
  activeThread: Thread | undefined;
  envLocked: boolean;
}): boolean {
  return Boolean(
    input.isServerThread &&
    input.activeThread &&
    input.activeThread.messages.length === 0 &&
    input.activeThread.worktreePath === null &&
    !input.envLocked,
  );
}

export function deriveChatViewToolbarEnvMode(input: {
  canOverrideServerThreadEnvMode: boolean;
  pendingServerThreadEnvMode: DraftThreadEnvMode | null;
  draftThreadEnvMode: DraftThreadEnvMode | undefined;
  derivedEnvMode: DraftThreadEnvMode;
}): DraftThreadEnvMode {
  if (input.canOverrideServerThreadEnvMode) {
    return input.pendingServerThreadEnvMode ?? input.draftThreadEnvMode ?? input.derivedEnvMode;
  }
  return input.derivedEnvMode;
}

export function deriveChatViewToolbarBranch(input: {
  canOverrideServerThreadEnvMode: boolean;
  pendingServerThreadBranch: string | null | undefined;
  activeThreadBranch: string | null | undefined;
}): string | null {
  if (input.canOverrideServerThreadEnvMode && input.pendingServerThreadBranch !== undefined) {
    return input.pendingServerThreadBranch;
  }
  return input.activeThreadBranch ?? null;
}
