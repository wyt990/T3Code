"use client";

import type {
  EnvironmentId,
  SshConnectionSummary,
  SshDirectoryBrowseEntry,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { readEnvironmentApi } from "../environmentApi";
import {
  getSshBrowseDirectoryPath,
  getSshBrowseLeafPathSegment,
  hasTrailingSshPathSeparator,
  normalizeSshBrowsePath,
} from "../lib/sshProjectPaths";
import type { CommandPaletteActionItem, CommandPaletteGroup } from "./CommandPalette.logic";

const SSH_BROWSE_STALE_TIME_MS = 30_000;
const SSH_BROWSE_MAX_RETRIES = 4;
const EMPTY_SSH_BROWSE_ENTRIES: readonly SshDirectoryBrowseEntry[] = [];

const isSshBrowseTransientError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /channel|sftp|timeout|temporarily|ECONN|unavailable|busy/i.test(message);
};

const formatSshBrowseError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "无法列出远程目录，请稍后重试。";
};

export function filterSshBrowseEntries(input: {
  browseEntries: ReadonlyArray<SshDirectoryBrowseEntry>;
  browseFilterQuery: string;
  highlightedItemValue: string | null;
}): {
  filteredEntries: SshDirectoryBrowseEntry[];
  highlightedEntry: SshDirectoryBrowseEntry | null;
  exactEntry: SshDirectoryBrowseEntry | null;
} {
  const lowerFilter = input.browseFilterQuery.toLowerCase();
  const showHidden = input.browseFilterQuery.startsWith(".");

  const filteredEntries = input.browseEntries.filter(
    (entry) =>
      entry.type === "directory" &&
      entry.name.toLowerCase().startsWith(lowerFilter) &&
      (showHidden || !entry.name.startsWith(".")),
  );

  let highlightedEntry: SshDirectoryBrowseEntry | null = null;
  if (input.highlightedItemValue?.startsWith("ssh-browse:")) {
    const highlightedPath = input.highlightedItemValue.slice("ssh-browse:".length);
    highlightedEntry = filteredEntries.find((entry) => entry.fullPath === highlightedPath) ?? null;
  }

  const exactEntry =
    input.browseFilterQuery.length > 0
      ? (filteredEntries.find((entry) => entry.name === input.browseFilterQuery) ?? null)
      : null;

  return { filteredEntries, highlightedEntry, exactEntry };
}

export function buildSshBrowseGroups(input: {
  browseEntries: ReadonlyArray<SshDirectoryBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void;
  browseTo: (name: string) => void;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "ssh-browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `ssh-browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        input.browseTo(entry.name);
      },
    });
  }

  return [{ value: "ssh-directories", label: "远程目录", items }];
}

export function buildSshConnectionPickerItems(input: {
  connections: ReadonlyArray<SshConnectionSummary>;
  onSelect: (connection: SshConnectionSummary) => Promise<void>;
  icon: ReactNode;
}): CommandPaletteActionItem[] {
  return input.connections.map((connection) => ({
    kind: "action",
    value: `ssh-connection:${connection.id}`,
    searchTerms: [
      connection.label,
      connection.host,
      connection.username,
      String(connection.port),
      connection.id,
    ],
    title: connection.label,
    description: `${connection.username}@${connection.host}:${connection.port}`,
    icon: input.icon,
    keepOpen: true,
    run: async () => {
      await input.onSelect(connection);
    },
  }));
}

export function useSshDirectoryBrowse(input: {
  environmentId: EnvironmentId | null;
  connectionId: string | null;
  query: string;
  enabled: boolean;
}) {
  const browseDirectoryPath = normalizeSshBrowsePath(input.query);
  const browseFilterQuery =
    input.enabled && !hasTrailingSshPathSeparator(browseDirectoryPath)
      ? getSshBrowseLeafPathSegment(browseDirectoryPath)
      : "";

  const listPath = getSshBrowseDirectoryPath(browseDirectoryPath).replace(/\/+$/, "") || "/";

  const queryResult = useQuery({
    queryKey: ["sshListDirectory", input.environmentId, input.connectionId, listPath],
    queryFn: async () => {
      if (!input.environmentId || !input.connectionId) {
        return null;
      }
      const api = readEnvironmentApi(input.environmentId);
      if (!api) {
        return null;
      }
      return api.ssh.listDirectory({
        connectionId: input.connectionId,
        path: listPath,
      });
    },
    staleTime: SSH_BROWSE_STALE_TIME_MS,
    enabled: input.enabled && input.environmentId !== null && input.connectionId !== null,
    retry: (failureCount, error) => {
      if (!isSshBrowseTransientError(error)) {
        return false;
      }
      return failureCount < SSH_BROWSE_MAX_RETRIES;
    },
    retryDelay: (attempt) => Math.min(5_000, 400 * 2 ** (attempt - 1)),
  });

  const browseEntries = queryResult.data?.entries ?? EMPTY_SSH_BROWSE_ENTRIES;
  const browseErrorMessage =
    queryResult.isError && !queryResult.isFetching ? formatSshBrowseError(queryResult.error) : null;

  return {
    browseDirectoryPath,
    browseFilterQuery,
    browseResult: queryResult.data ?? null,
    browseEntries,
    browseErrorMessage,
    isBrowsePending: queryResult.isPending || queryResult.isFetching,
    listPath,
  };
}
