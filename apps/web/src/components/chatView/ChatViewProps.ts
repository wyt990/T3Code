import type { EnvironmentId, ScopedThreadRef, ThreadId, TurnId } from "@t3tools/contracts";
import type { DraftId } from "../../composerDraftStore";

export interface ChatViewSharedProps {
  /**
   * Whether the diff panel is currently open. Owned by the route/tab layer;
   * ChatView reflects it via header buttons and conditional layout.
   */
  diffOpen: boolean;
  /**
   * Toggle the diff panel for the current thread. The caller is responsible
   * for any URL/route updates that should accompany the toggle.
   */
  onToggleDiff: () => void;
  /**
   * Open the diff panel pinned to a specific turn (and optional file).
   * The caller is responsible for any URL/route updates.
   */
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  /**
   * Switch the surrounding navigation to a server thread. Returns a promise
   * the caller can await when navigation must complete before proceeding.
   */
  onRequestThreadNavigation: (target: ScopedThreadRef) => Promise<void>;
  /**
   * Switch the surrounding navigation to a draft thread. Returns a promise
   * the caller can await when navigation must complete before proceeding.
   */
  onRequestDraftNavigation: (draftId: DraftId) => Promise<void>;
  /**
   * Whether this ChatView instance currently owns global keyboard focus.
   * Defaults to true at single-tab call sites; multi-tab callers gate the
   * value to avoid duplicate shortcut handling across split panels.
   */
  isFocused: boolean;
  /**
   * Request focus for this ChatView instance. Currently a no-op at single-tab
   * call sites; the multi-tab shell promotes the corresponding tab on call.
   */
  onRequestFocus: () => void;
}

export type ChatViewProps = ChatViewSharedProps &
  (
    | {
        environmentId: EnvironmentId;
        threadId: ThreadId;
        onDiffPanelOpen?: () => void;
        reserveTitleBarControlInset?: boolean;
        routeKind: "server";
        draftId?: never;
      }
    | {
        environmentId: EnvironmentId;
        threadId: ThreadId;
        onDiffPanelOpen?: () => void;
        reserveTitleBarControlInset?: boolean;
        routeKind: "draft";
        draftId: DraftId;
      }
  );
