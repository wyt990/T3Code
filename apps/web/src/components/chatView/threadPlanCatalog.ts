import type { ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { useStore } from "../../store";
import type { Thread } from "../../types";

const EMPTY_PROPOSED_PLANS: Thread["proposedPlans"] = [];

export type ThreadPlanCatalogEntry = Pick<Thread, "id" | "proposedPlans">;

type ThreadPlanCacheEntry = {
  shell: object | null;
  proposedPlanIds: readonly string[] | undefined;
  proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined;
  entry: ThreadPlanCatalogEntry;
};

type EnvironmentPlanIndex = Record<
  string,
  {
    threadShellById: Record<string, object>;
    proposedPlanIdsByThreadId: Record<string, readonly string[]>;
    proposedPlanByThreadId: Record<string, Record<string, Thread["proposedPlans"][number]>>;
  }
>;

export function findThreadShellAndPlans(
  environmentStateById: EnvironmentPlanIndex,
  threadId: ThreadId,
):
  | {
      shell: object;
      proposedPlanIds: readonly string[] | undefined;
      proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined;
    }
  | undefined {
  for (const environmentState of Object.values(environmentStateById)) {
    const matchedShell = environmentState.threadShellById[threadId];
    if (!matchedShell) {
      continue;
    }
    return {
      shell: matchedShell,
      proposedPlanIds: environmentState.proposedPlanIdsByThreadId[threadId],
      proposedPlansById: environmentState.proposedPlanByThreadId[threadId],
    };
  }
  return undefined;
}

export function buildProposedPlans(
  proposedPlanIds: readonly string[] | undefined,
  proposedPlansById: Record<string, Thread["proposedPlans"][number]> | undefined,
): Thread["proposedPlans"] {
  if (!proposedPlanIds || proposedPlanIds.length === 0 || !proposedPlansById) {
    return EMPTY_PROPOSED_PLANS;
  }
  return proposedPlanIds.flatMap((planId) => {
    const proposedPlan = proposedPlansById[planId];
    return proposedPlan ? [proposedPlan] : [];
  });
}

function cacheEntryWhenShellMissing(
  threadId: ThreadId,
  previous: ThreadPlanCacheEntry | undefined,
): { entry: ThreadPlanCacheEntry; changed: boolean } {
  if (
    previous?.shell === null &&
    previous?.proposedPlanIds === undefined &&
    previous?.proposedPlansById === undefined
  ) {
    return { entry: previous, changed: false };
  }
  return {
    entry: {
      shell: null,
      proposedPlanIds: undefined,
      proposedPlansById: undefined,
      entry: { id: threadId, proposedPlans: EMPTY_PROPOSED_PLANS },
    },
    changed: true,
  };
}

function cacheEntryWhenShellPresent(
  threadId: ThreadId,
  found: NonNullable<ReturnType<typeof findThreadShellAndPlans>>,
  previous: ThreadPlanCacheEntry | undefined,
): { entry: ThreadPlanCacheEntry; pushEntry: ThreadPlanCatalogEntry; changed: boolean } {
  const { shell, proposedPlanIds, proposedPlansById } = found;
  if (
    previous?.shell === shell &&
    previous?.proposedPlanIds === proposedPlanIds &&
    previous?.proposedPlansById === proposedPlansById
  ) {
    return { entry: previous, pushEntry: previous.entry, changed: false };
  }
  const proposedPlans = buildProposedPlans(proposedPlanIds, proposedPlansById);
  const entry = { id: threadId, proposedPlans };
  return {
    entry: { shell, proposedPlanIds, proposedPlansById, entry },
    pushEntry: entry,
    changed: true,
  };
}

function collectThreadPlanCatalog(
  threadIds: readonly ThreadId[],
  environmentStateById: EnvironmentPlanIndex,
  previousEntries: Map<ThreadId, ThreadPlanCacheEntry>,
): {
  changed: boolean;
  nextEntries: Map<ThreadId, ThreadPlanCacheEntry>;
  nextResult: ThreadPlanCatalogEntry[];
} {
  const nextEntries = new Map<ThreadId, ThreadPlanCacheEntry>();
  const nextResult: ThreadPlanCatalogEntry[] = [];
  let changed = false;

  for (const threadId of threadIds) {
    const found = findThreadShellAndPlans(environmentStateById, threadId);
    if (!found) {
      const missing = cacheEntryWhenShellMissing(threadId, previousEntries.get(threadId));
      nextEntries.set(threadId, missing.entry);
      if (missing.changed) {
        changed = true;
      }
      continue;
    }

    const present = cacheEntryWhenShellPresent(threadId, found, previousEntries.get(threadId));
    nextEntries.set(threadId, present.entry);
    nextResult.push(present.pushEntry);
    if (present.changed) {
      changed = true;
    }
  }

  return { changed, nextEntries, nextResult };
}

export function useThreadPlanCatalog(threadIds: readonly ThreadId[]): ThreadPlanCatalogEntry[] {
  return useStore(
    useMemo(() => {
      let previousThreadIds: readonly ThreadId[] = [];
      let previousResult: ThreadPlanCatalogEntry[] = [];
      let previousEntries = new Map<ThreadId, ThreadPlanCacheEntry>();

      return (state: { environmentStateById: EnvironmentPlanIndex }) => {
        const sameThreadIds =
          previousThreadIds.length === threadIds.length &&
          previousThreadIds.every((id, index) => id === threadIds[index]);
        let changed = !sameThreadIds;

        const {
          nextEntries,
          nextResult,
          changed: catalogChanged,
        } = collectThreadPlanCatalog(threadIds, state.environmentStateById, previousEntries);
        changed ||= catalogChanged;

        if (!changed && previousResult.length === nextResult.length) {
          return previousResult;
        }

        previousThreadIds = threadIds;
        previousEntries = nextEntries;
        previousResult = nextResult;
        return nextResult;
      };
    }, [threadIds]),
  );
}
