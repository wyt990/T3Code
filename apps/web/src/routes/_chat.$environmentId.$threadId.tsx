import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { threadHasStarted } from "../components/ChatView.logic";
import { TabbedShell } from "../components/TabBar";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import { parseDiffRouteSearch } from "../diffRouteSearch";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef } from "../threadRoutes";
import type { TabTarget } from "../uiTabsState";

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  const urlTarget = useMemo<TabTarget | null>(
    () => (threadRef ? { kind: "server", threadRef } : null),
    [threadRef],
  );

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  return <TabbedShell urlTarget={urlTarget} legacyDiffOpenInUrl={search.diff === "1"} />;
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  // Phase 2 made `diff` per-tab state owned by `TabbedShell`. The URL still
  // accepts the legacy `?diff=1` flag (via parseDiffRouteSearch) so old links
  // continue to work — TabbedShell hydrates that flag onto the active tab and
  // immediately strips it. No `retainSearchParams` is needed because we don't
  // want `?diff=1` re-attached during navigation.
  validateSearch: (search) => parseDiffRouteSearch(search),
  component: ChatThreadRouteView,
});
