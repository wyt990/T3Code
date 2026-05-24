"use client";

import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type EnvironmentId,
  type FilesystemBrowseResult,
  type ProjectId,
} from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ClockIcon,
  CornerLeftUpIcon,
  FolderIcon,
  FolderPlusIcon,
  GalleryHorizontalEndIcon,
  MergeIcon,
  MessageSquareIcon,
  ServerIcon,
  SettingsIcon,
  SplitIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  parseNaturalLanguage,
  useCommandPaletteStore,
  type CommandContext,
} from "../commandPaletteStore";
import { readEnvironmentApi } from "../environmentApi";
import { readPrimaryEnvironmentDescriptor, usePrimaryEnvironmentId } from "../environments/primary";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import { readLocalApi } from "../localApi";
import {
  startNewThreadInProjectFromContext,
  startNewThreadFromContext,
} from "../lib/chatThreadActions";
import {
  appendBrowsePathSegment,
  canNavigateUp,
  ensureBrowseDirectoryPath,
  findProjectByPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import {
  appendSshBrowsePathSegment,
  canNavigateSshUp,
  getSshBrowseParentPath,
  hasTrailingSshPathSeparator,
  resolveSshProjectWorkspaceRoot,
  SSH_BROWSE_INITIAL_PATH,
} from "../lib/sshProjectPaths";
import { isTerminalFocused } from "../lib/terminalFocus";
import { getLatestThreadForProject } from "../lib/threadSort";
import {
  cn,
  getPlatformString,
  isMacPlatform,
  isWindowsPlatform,
  newCommandId,
  newProjectId,
} from "../lib/utils";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { CommandPaletteNlBootstrap } from "./CommandPaletteNlBootstrap";
import {
  buildSshBrowseGroups,
  buildSshConnectionPickerItems,
  filterSshBrowseEntries,
  useSshDirectoryBrowse,
} from "./SshDirectoryBrowser";
import {
  ADDON_ICON_CLASS,
  buildBrowseGroups,
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterBrowseEntries,
  filterCommandPaletteGroups,
  type CommandPaletteGroup,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  ITEM_ICON_CLASS,
  RECENT_THREAD_LIMIT,
} from "./CommandPalette.logic";
import { resolveEnvironmentOptionLabel } from "./BranchToolbar.logic";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { ProjectFavicon } from "./ProjectFavicon";
import { ThreadRowLeadingStatus, ThreadRowTrailingStatus } from "./ThreadStatusIndicators";
import { useServerKeybindings } from "../rpc/serverState";
import { resolveShortcutCommand } from "../keybindings";
import { useUiStateStore } from "../uiStateStore";
import {
  buildTabBarItemGroups,
  pickAutoMergeCandidate,
  resolveTabTitle,
} from "./TabBar/TabBar.logic";
import { closeTabsAndSyncRoute } from "./TabBar/tabCloseBehavior";
import { findMergedPair } from "../uiTabsState";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandInput,
  CommandPanel,
} from "./ui/command";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "./chat/ChatComposer";

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];
const BROWSE_STALE_TIME_MS = 30_000;

function getLocalFileManagerName(platform: string): string {
  if (isMacPlatform(platform)) {
    return "访达";
  }
  if (isWindowsPlatform(platform)) {
    return "资源管理器";
  }
  return "文件管理器";
}

function getEnvironmentBrowsePlatform(os: string | null | undefined): string {
  if (os === "windows") {
    return "Win32";
  }
  if (os === "darwin") {
    return "MacIntel";
  }
  if (os === "linux") {
    return "Linux";
  }
  return getPlatformString();
}

interface AddProjectEnvironmentOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
}

export function CommandPalette({ children }: { readonly children: ReactNode }) {
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const toggleOpen = useCommandPaletteStore((store) => store.toggleOpen);
  const keybindings = useServerKeybindings();
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });
      if (command !== "commandPalette.toggle") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleOpen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, terminalOpen, toggleOpen]);

  return (
    <ComposerHandleContext.Provider value={composerHandleRef}>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandPaletteNlBootstrap />
        {children}
        <CommandPaletteDialog />
      </CommandDialog>
    </ComposerHandleContext.Provider>
  );
}

function CommandPaletteDialog() {
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);

  useEffect(() => {
    return () => {
      setOpen(false);
    };
  }, [setOpen]);

  if (!open) {
    return null;
  }

  return <OpenCommandPaletteDialog />;
}

function OpenCommandPaletteDialog() {
  const navigate = useNavigate();
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const openIntent = useCommandPaletteStore((store) => store.openIntent);
  const clearOpenIntent = useCommandPaletteStore((store) => store.clearOpenIntent);
  const composerHandleRef = useComposerHandleContext();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const queryClient = useQueryClient();
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const settings = useSettings();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const keybindings = useServerKeybindings();
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const currentView = viewStack.at(-1) ?? null;
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const [addProjectEnvironmentId, setAddProjectEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const [addProjectSshConnection, setAddProjectSshConnection] = useState<{
    readonly connectionId: string;
    readonly label: string;
  } | null>(null);
  const [isPickingProjectFolder, setIsPickingProjectFolder] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryEnvironmentLabel = readPrimaryEnvironmentDescriptor()?.label ?? null;
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((state) => state.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);

  const addProjectEnvironmentOptions = useMemo(() => {
    const options: AddProjectEnvironmentOption[] = [];
    const seenEnvironmentIds = new Set<EnvironmentId>();

    if (primaryEnvironmentId) {
      seenEnvironmentIds.add(primaryEnvironmentId);
      options.push({
        environmentId: primaryEnvironmentId,
        label: resolveEnvironmentOptionLabel({
          isPrimary: true,
          environmentId: primaryEnvironmentId,
          runtimeLabel: primaryEnvironmentLabel,
        }),
        isPrimary: true,
      });
    }

    for (const record of Object.values(savedEnvironmentRegistry)) {
      if (seenEnvironmentIds.has(record.environmentId)) {
        continue;
      }

      const runtimeState = savedEnvironmentRuntimeById[record.environmentId];
      options.push({
        environmentId: record.environmentId,
        label: resolveEnvironmentOptionLabel({
          isPrimary: false,
          environmentId: record.environmentId,
          runtimeLabel: runtimeState?.descriptor?.label ?? null,
          savedLabel: record.label,
        }),
        isPrimary: false,
      });
    }

    options.sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });

    return options;
  }, [
    primaryEnvironmentId,
    primaryEnvironmentLabel,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);
  const defaultAddProjectEnvironmentId = addProjectEnvironmentOptions[0]?.environmentId ?? null;
  const browseEnvironmentId = addProjectEnvironmentId ?? defaultAddProjectEnvironmentId;
  const browseEnvironmentPlatform = useMemo(() => {
    const os =
      browseEnvironmentId && primaryEnvironmentId && browseEnvironmentId === primaryEnvironmentId
        ? (readPrimaryEnvironmentDescriptor()?.platform.os ?? null)
        : browseEnvironmentId
          ? (savedEnvironmentRuntimeById[browseEnvironmentId]?.descriptor?.platform.os ??
            savedEnvironmentRuntimeById[browseEnvironmentId]?.serverConfig?.environment.platform
              .os ??
            null)
          : null;
    return getEnvironmentBrowsePlatform(os);
  }, [browseEnvironmentId, primaryEnvironmentId, savedEnvironmentRuntimeById]);
  const isFilesystemBrowsing =
    addProjectSshConnection === null && isFilesystemBrowseQuery(query, browseEnvironmentPlatform);
  const isSshBrowsing = addProjectSshConnection !== null;
  const isBrowsing = isFilesystemBrowsing || isSshBrowsing;
  const paletteMode = getCommandPaletteMode({ currentView, isBrowsing });
  const getAddProjectInitialQueryForEnvironment = useCallback(
    (environmentId: EnvironmentId | null): string => {
      const environmentSettings =
        environmentId && primaryEnvironmentId && environmentId === primaryEnvironmentId
          ? settings
          : environmentId
            ? savedEnvironmentRuntimeById[environmentId]?.serverConfig?.settings
            : null;
      const baseDirectory = environmentSettings?.addProjectBaseDirectory?.trim() ?? "";
      if (baseDirectory.length === 0) {
        return "~/";
      }
      return ensureBrowseDirectoryPath(baseDirectory);
    },
    [primaryEnvironmentId, savedEnvironmentRuntimeById, settings],
  );

  const projectCwdById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.cwd])),
    [projects],
  );
  const projectTitleById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const activeThreadId = activeThread?.id;
  const currentProjectEnvironmentId =
    activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null;
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;

  useEffect(() => {
    const payload: CommandContext = {};
    if (currentProjectCwd !== null) {
      payload.currentFile = currentProjectCwd;
      payload.recentFiles = [currentProjectCwd];
    }
    if (activeThreadId) {
      payload.currentMode = "thread";
    } else if (activeDraftThread) {
      payload.currentMode = "draft";
    }
    useCommandPaletteStore.getState().updateContextAwareSuggestions(payload);
  }, [activeDraftThread, activeThreadId, currentProjectCwd]);
  const currentProjectCwdForBrowse =
    browseEnvironmentId && currentProjectEnvironmentId === browseEnvironmentId
      ? currentProjectCwd
      : null;
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwdForBrowse === null;
  const browseDirectoryPath = isFilesystemBrowsing ? getBrowseDirectoryPath(query) : "";
  const browseFilterQuery =
    isFilesystemBrowsing && !hasTrailingPathSeparator(query) ? getBrowseLeafPathSegment(query) : "";

  const sshBrowse = useSshDirectoryBrowse({
    environmentId: browseEnvironmentId,
    connectionId: addProjectSshConnection?.connectionId ?? null,
    query,
    enabled: isSshBrowsing,
  });

  const fetchBrowseResult = useCallback(
    async (partialPath: string): Promise<FilesystemBrowseResult | null> => {
      if (!browseEnvironmentId) return null;
      const api = readEnvironmentApi(browseEnvironmentId);
      if (!api) return null;
      return api.filesystem.browse({
        partialPath,
        ...(currentProjectCwdForBrowse ? { cwd: currentProjectCwdForBrowse } : {}),
      });
    },
    [browseEnvironmentId, currentProjectCwdForBrowse],
  );

  const { data: browseResult, isPending: isBrowsePending } = useQuery({
    queryKey: [
      "filesystemBrowse",
      browseEnvironmentId,
      browseDirectoryPath,
      currentProjectCwdForBrowse,
    ],
    queryFn: () => fetchBrowseResult(browseDirectoryPath),
    staleTime: BROWSE_STALE_TIME_MS,
    enabled:
      isFilesystemBrowsing &&
      browseDirectoryPath.length > 0 &&
      browseEnvironmentId !== null &&
      !relativePathNeedsActiveProject,
  });
  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const {
    filteredEntries: filteredBrowseEntries,
    highlightedEntry: highlightedBrowseEntry,
    exactEntry: exactBrowseEntry,
  } = useMemo(
    () => filterBrowseEntries({ browseEntries, browseFilterQuery, highlightedItemValue }),
    [browseEntries, browseFilterQuery, highlightedItemValue],
  );

  const prefetchBrowsePath = useCallback(
    (partialPath: string) => {
      void queryClient.prefetchQuery({
        queryKey: [
          "filesystemBrowse",
          browseEnvironmentId,
          partialPath,
          currentProjectCwdForBrowse,
        ],
        queryFn: () => fetchBrowseResult(partialPath),
        staleTime: BROWSE_STALE_TIME_MS,
      });
    },
    [browseEnvironmentId, currentProjectCwdForBrowse, fetchBrowseResult, queryClient],
  );

  // Prefetch the parent and the most likely next child so browse navigation
  // stays warm without scanning every child directory in large trees.
  useEffect(() => {
    if (!isFilesystemBrowsing || filteredBrowseEntries.length === 0) return;

    if (canNavigateUp(query)) {
      prefetchBrowsePath(getBrowseParentPath(query)!);
    }

    const nextChild = highlightedBrowseEntry ?? exactBrowseEntry;
    if (nextChild) {
      prefetchBrowsePath(appendBrowsePathSegment(query, nextChild.name));
    }
  }, [
    exactBrowseEntry,
    filteredBrowseEntries.length,
    highlightedBrowseEntry,
    isFilesystemBrowsing,
    prefetchBrowsePath,
    query,
  ]);

  const {
    filteredEntries: filteredSshBrowseEntries,
    highlightedEntry: _highlightedSshBrowseEntry,
    exactEntry: exactSshBrowseEntry,
  } = useMemo(
    () =>
      filterSshBrowseEntries({
        browseEntries: sshBrowse.browseEntries,
        browseFilterQuery: sshBrowse.browseFilterQuery,
        highlightedItemValue,
      }),
    [highlightedItemValue, sshBrowse.browseEntries, sshBrowse.browseFilterQuery],
  );

  const openProjectFromSearch = useMemo(
    () => async (project: (typeof projects)[number]) => {
      const latestThread = getLatestThreadForProject(
        threads.filter((thread) => thread.environmentId === project.environmentId),
        project.id,
        settings.sidebarThreadSortOrder,
      );
      if (latestThread) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.environmentId, latestThread.id),
          ),
        });
        return;
      }

      await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        envMode: settings.defaultThreadEnvMode,
      });
    },
    [
      handleNewThread,
      navigate,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const projectSearchItems = useMemo(
    () =>
      buildProjectActionItems({
        projects,
        valuePrefix: "project",
        icon: (project) => (
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.cwd}
            className={ITEM_ICON_CLASS}
          />
        ),
        runProject: openProjectFromSearch,
      }),
    [openProjectFromSearch, projects],
  );

  const projectThreadItems = useMemo(
    () =>
      buildProjectActionItems({
        projects,
        valuePrefix: "new-thread-in",
        icon: (project) => (
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.cwd}
            className={ITEM_ICON_CLASS}
          />
        ),
        runProject: async (project) => {
          await startNewThreadInProjectFromContext(
            {
              activeDraftThread,
              activeThread,
              defaultProjectRef,
              defaultThreadEnvMode: settings.defaultThreadEnvMode,
              handleNewThread,
            },
            scopeProjectRef(project.environmentId, project.id),
          );
        },
      }),
    [
      activeDraftThread,
      activeThread,
      defaultProjectRef,
      handleNewThread,
      projects,
      settings.defaultThreadEnvMode,
    ],
  );

  const allThreadItems = useMemo(
    () =>
      buildThreadActionItems({
        threads,
        ...(activeThreadId ? { activeThreadId } : {}),
        projectTitleById,
        sortOrder: settings.sidebarThreadSortOrder,
        icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
        renderLeadingContent: (thread) => <ThreadRowLeadingStatus thread={thread} />,
        renderTrailingContent: (thread) => <ThreadRowTrailingStatus thread={thread} />,
        runThread: async (thread) => {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
          });
        },
      }),
    [activeThreadId, navigate, projectTitleById, settings.sidebarThreadSortOrder, threads],
  );
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  function pushPaletteView(view: CommandPaletteView): void {
    setViewStack((previousViews) => [
      ...previousViews,
      {
        addonIcon: view.addonIcon,
        groups: view.groups,
        ...(view.initialQuery ? { initialQuery: view.initialQuery } : {}),
      },
    ]);
    setHighlightedItemValue(null);
    setQuery(view.initialQuery ?? "");
  }

  function pushView(item: CommandPaletteSubmenuItem): void {
    pushPaletteView({
      addonIcon: item.addonIcon,
      groups: item.groups,
      ...(item.initialQuery ? { initialQuery: item.initialQuery } : {}),
    });
  }

  function popView(): void {
    if (viewStack.length <= 1) {
      setAddProjectEnvironmentId(null);
      setAddProjectSshConnection(null);
    }
    setViewStack((previousViews) => previousViews.slice(0, -1));
    setHighlightedItemValue(null);
    setQuery("");
  }

  function handleQueryChange(nextQuery: string): void {
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    if (nextQuery === "" && currentView?.initialQuery) {
      popView();
    }
  }

  const startAddProjectBrowse = useCallback(
    (environmentId: EnvironmentId): void => {
      setAddProjectSshConnection(null);
      setAddProjectEnvironmentId(environmentId);
      pushPaletteView({
        addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
        groups: [],
        initialQuery: getAddProjectInitialQueryForEnvironment(environmentId),
      });
    },
    [getAddProjectInitialQueryForEnvironment],
  );

  const startAddProjectSshBrowse = useCallback(
    (
      environmentId: EnvironmentId,
      connection: { readonly connectionId: string; readonly label: string },
    ) => {
      setAddProjectEnvironmentId(environmentId);
      setAddProjectSshConnection(connection);
      setViewStack([]);
      setHighlightedItemValue(null);
      setQuery(SSH_BROWSE_INITIAL_PATH);
      setBrowseGeneration((generation) => generation + 1);
    },
    [],
  );

  const openAddProjectSshFlow = useCallback(async () => {
    const environmentId = defaultAddProjectEnvironmentId;
    if (!environmentId) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法添加 SSH 项目",
          description: "没有可用的环境。",
        }),
      );
      return;
    }

    const api = readEnvironmentApi(environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法添加 SSH 项目",
          description: "环境未连接。",
        }),
      );
      return;
    }

    let connections;
    try {
      connections = await api.ssh.listConnections();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法加载 SSH 连接",
          description: error instanceof Error ? error.message : "发生错误。",
        }),
      );
      return;
    }

    if (connections.length === 0) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无 SSH 连接",
          description: "请先在设置中添加 SSH 连接。",
        }),
      );
      return;
    }

    setAddProjectEnvironmentId(environmentId);
    setAddProjectSshConnection(null);
    pushPaletteView({
      addonIcon: <ServerIcon className={ADDON_ICON_CLASS} />,
      groups: [
        {
          value: "ssh-connections",
          label: "SSH 连接",
          items: buildSshConnectionPickerItems({
            connections,
            icon: <ServerIcon className={ITEM_ICON_CLASS} />,
            onSelect: async (connection) => {
              startAddProjectSshBrowse(environmentId, {
                connectionId: connection.id,
                label: connection.label,
              });
            },
          }),
        },
      ],
    });
  }, [defaultAddProjectEnvironmentId, startAddProjectSshBrowse]);

  const addProjectEnvironmentItems: CommandPaletteActionItem[] = addProjectEnvironmentOptions.map(
    (option) => ({
      kind: "action",
      value: `action:add-project:environment:${option.environmentId}`,
      searchTerms: [option.label, option.environmentId, option.isPrimary ? "this device" : ""],
      title: option.label,
      description: option.isPrimary ? "本机" : option.environmentId,
      icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      run: async () => {
        startAddProjectBrowse(option.environmentId);
      },
    }),
  );

  const addProjectEnvironmentGroups = useMemo<CommandPaletteView["groups"]>(
    () => [
      {
        value: "environments",
        label: "环境",
        items: addProjectEnvironmentItems,
      },
    ],
    [addProjectEnvironmentItems],
  );

  const openAddProjectFlow = useCallback(() => {
    if (addProjectEnvironmentOptions.length > 1) {
      pushPaletteView({
        addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
        groups: addProjectEnvironmentGroups,
      });
      return;
    }

    const environmentId = defaultAddProjectEnvironmentId;
    if (!environmentId) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法浏览项目",
          description: "没有可用的环境。",
        }),
      );
      return;
    }

    startAddProjectBrowse(environmentId);
  }, [
    addProjectEnvironmentGroups,
    addProjectEnvironmentOptions.length,
    defaultAddProjectEnvironmentId,
    startAddProjectBrowse,
  ]);

  useEffect(() => {
    if (openIntent?.kind === "add-project") {
      clearOpenIntent();
      openAddProjectFlow();
    } else if (openIntent?.kind === "add-project-ssh") {
      clearOpenIntent();
      void openAddProjectSshFlow();
    }
  }, [clearOpenIntent, openAddProjectFlow, openAddProjectSshFlow, openIntent]);

  const paletteRegisteredCommands = useCommandPaletteStore((s) => s.commands);
  const nlPaletteMatches = useMemo(() => {
    const q = deferredQuery.trim();
    if (q.length < 2) {
      return [];
    }
    return parseNaturalLanguage(q, paletteRegisteredCommands);
  }, [deferredQuery, paletteRegisteredCommands]);

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

  const nlQuery = deferredQuery.trim();
  for (let i = nlPaletteMatches.length - 1; i >= 0; i--) {
    const cmd = nlPaletteMatches[i]!;
    actionItems.unshift({
      kind: "action",
      value: `nl:${cmd.id}:${encodeURIComponent(cmd.title)}`,
      searchTerms: [...cmd.keywords, cmd.title, nlQuery],
      title: (
        <>
          <span className="text-muted-foreground me-1">NL</span>
          {cmd.title}
        </>
      ),
      ...(cmd.description ? { description: cmd.description } : {}),
      icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        useCommandPaletteStore.getState().addRecentQuery(nlQuery, cmd.id);
        cmd.action();
      },
    });
  }

  if (projects.length > 0) {
    const activeProjectTitle = currentProjectId
      ? (projectTitleById.get(currentProjectId) ?? null)
      : null;

    if (activeProjectTitle) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: (
          <>
            在 <span className="font-semibold">{activeProjectTitle}</span> 中新建对话
          </>
        ),
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.new",
        run: async () => {
          await startNewThreadFromContext({
            activeDraftThread,
            activeThread,
            defaultProjectRef,
            defaultThreadEnvMode: settings.defaultThreadEnvMode,
            handleNewThread,
          });
        },
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "在...中新建项目",
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
      groups: [{ value: "projects", label: "项目", items: projectThreadItems }],
    });
  }

  if (addProjectEnvironmentOptions.length > 1) {
    actionItems.push({
      kind: "submenu",
      value: "action:add-project",
      searchTerms: ["add project", "folder", "directory", "browse", "environment"],
      title: "添加项目",
      icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
      groups: addProjectEnvironmentGroups,
    });
  } else {
    actionItems.push({
      kind: "action",
      value: "action:add-project",
      searchTerms: ["add project", "folder", "directory", "browse"],
      title: "添加项目",
      icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      run: async () => {
        openAddProjectFlow();
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:add-project-ssh",
    searchTerms: ["add project", "ssh", "remote", "server", "sftp"],
    title: "添加 SSH 远程项目",
    icon: <ServerIcon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    run: async () => {
      await openAddProjectSshFlow();
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "打开设置",
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/settings" });
    },
  });

  // ── Tab actions (Phase 3.4) ────────────────────────────────────────────────
  // Surface the most-used tab operations alongside the existing palette
  // actions. Per-tab "Switch to..." entries live in their own group below.
  const tabActionItems = buildTabPaletteActionItems({ navigate });
  for (const item of tabActionItems) {
    actionItems.push(item);
  }
  const tabSwitchItems = useTabSwitchPaletteItems({ navigate });

  const rootGroups = buildRootGroups({ actionItems, recentThreadItems, tabSwitchItems });
  const activeGroups = currentView ? currentView.groups : rootGroups;

  const filteredGroups = filterCommandPaletteGroups({
    activeGroups,
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems: projectSearchItems,
    threadSearchItems: allThreadItems,
  });

  const handleAddProject = useCallback(
    async (rawCwd: string) => {
      if (!browseEnvironmentId) return;
      const api = readEnvironmentApi(browseEnvironmentId);
      if (!api) return;

      if (isUnsupportedWindowsProjectPath(rawCwd.trim(), browseEnvironmentPlatform)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "添加项目失败",
            description: "Windows 风格路径仅在 Windows 系统上支持。",
          }),
        );
        return;
      }

      if (isExplicitRelativeProjectPath(rawCwd.trim()) && !currentProjectCwdForBrowse) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "添加项目失败",
            description: "相对路径需要当前有活动项目。",
          }),
        );
        return;
      }

      const cwd = resolveProjectPathForDispatch(rawCwd, currentProjectCwdForBrowse);
      if (cwd.length === 0) return;

      const existing = findProjectByPath(
        projects.filter((project) => project.environmentId === browseEnvironmentId),
        cwd,
      );
      if (existing) {
        const latestThread = getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === existing.environmentId),
          existing.id,
          settings.sidebarThreadSortOrder,
        );
        if (latestThread) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(latestThread.environmentId, latestThread.id),
            ),
          });
        } else {
          await handleNewThread(scopeProjectRef(existing.environmentId, existing.id), {
            envMode: settings.defaultThreadEnvMode,
          }).catch(() => undefined);
        }
        setOpen(false);
        return;
      }

      try {
        const projectId = newProjectId();
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title: inferProjectTitleFromPath(cwd),
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          createdAt: new Date().toISOString(),
        });
        await handleNewThread(scopeProjectRef(browseEnvironmentId, projectId), {
          envMode: settings.defaultThreadEnvMode,
        }).catch(() => undefined);
        setOpen(false);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "添加项目失败",
            description: error instanceof Error ? error.message : "发生错误。",
          }),
        );
      }
    },
    [
      browseEnvironmentId,
      browseEnvironmentPlatform,
      currentProjectCwdForBrowse,
      handleNewThread,
      navigate,
      projects,
      setOpen,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const handleAddSshProject = useCallback(
    async (rawPath: string) => {
      if (!browseEnvironmentId || !addProjectSshConnection) {
        return;
      }

      const api = readEnvironmentApi(browseEnvironmentId);
      if (!api) {
        return;
      }

      const workspaceRoot = resolveSshProjectWorkspaceRoot(rawPath);
      if (workspaceRoot.length === 0) {
        return;
      }

      const existing = findProjectByPath(
        projects.filter((project) => project.environmentId === browseEnvironmentId),
        workspaceRoot,
      );
      if (existing) {
        const latestThread = getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === existing.environmentId),
          existing.id,
          settings.sidebarThreadSortOrder,
        );
        if (latestThread) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(latestThread.environmentId, latestThread.id),
            ),
          });
        } else {
          await handleNewThread(scopeProjectRef(existing.environmentId, existing.id), {
            envMode: settings.defaultThreadEnvMode,
          }).catch(() => undefined);
        }
        setOpen(false);
        return;
      }

      try {
        const projectId = newProjectId();
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title: inferProjectTitleFromPath(workspaceRoot),
          workspaceRoot,
          transport: {
            type: "ssh",
            sshConnectionId: addProjectSshConnection.connectionId,
          },
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: {
            provider: "claudeAgent",
            model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
          },
          createdAt: new Date().toISOString(),
        });
        await handleNewThread(scopeProjectRef(browseEnvironmentId, projectId), {
          envMode: settings.defaultThreadEnvMode,
        }).catch(() => undefined);
        setOpen(false);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "添加 SSH 项目失败",
            description: error instanceof Error ? error.message : "发生错误。",
          }),
        );
      }
    },
    [
      addProjectSshConnection,
      browseEnvironmentId,
      handleNewThread,
      navigate,
      projects,
      setOpen,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  function browseTo(name: string): void {
    const nextQuery = appendBrowsePathSegment(query, name);
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    setBrowseGeneration((generation) => generation + 1);
  }

  function browseUp(): void {
    const parentPath = getBrowseParentPath(query);
    if (parentPath === null) {
      return;
    }

    setHighlightedItemValue(null);
    setQuery(parentPath);
    setBrowseGeneration((generation) => generation + 1);
  }

  function sshBrowseTo(name: string): void {
    const nextQuery = appendSshBrowsePathSegment(query, name);
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    setBrowseGeneration((generation) => generation + 1);
  }

  function sshBrowseUp(): void {
    const parentPath = getSshBrowseParentPath(query);
    if (parentPath === null) {
      return;
    }

    setHighlightedItemValue(null);
    setQuery(parentPath);
    setBrowseGeneration((generation) => generation + 1);
  }

  // Resolve the add-project path from browse data when available. When the
  // query has a trailing separator (e.g. "~/projects/foo/"), parentPath is the
  // directory itself. Otherwise the user typed a partial leaf name, so we need
  // the exact browse entry's fullPath or fall back to the raw query.
  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? (browseResult?.parentPath ?? query.trim())
    : (exactBrowseEntry?.fullPath ?? query.trim());

  const resolvedAddSshProjectPath = hasTrailingSshPathSeparator(query)
    ? (sshBrowse.browseResult?.parentPath ?? query.trim())
    : (exactSshBrowseEntry?.fullPath ?? query.trim());

  const canBrowseUp =
    isFilesystemBrowsing && !relativePathNeedsActiveProject && canNavigateUp(browseDirectoryPath);

  const canSshBrowseUp = isSshBrowsing && canNavigateSshUp(query);

  const browseGroups = buildBrowseGroups({
    browseEntries: filteredBrowseEntries,
    browseQuery: query,
    canBrowseUp,
    upIcon: <CornerLeftUpIcon className={ITEM_ICON_CLASS} />,
    directoryIcon: <FolderIcon className={ITEM_ICON_CLASS} />,
    browseUp,
    browseTo,
  });

  const sshBrowseGroups = buildSshBrowseGroups({
    browseEntries: filteredSshBrowseEntries,
    browseQuery: query,
    canBrowseUp: canSshBrowseUp,
    upIcon: <CornerLeftUpIcon className={ITEM_ICON_CLASS} />,
    directoryIcon: <FolderIcon className={ITEM_ICON_CLASS} />,
    browseUp: sshBrowseUp,
    browseTo: sshBrowseTo,
  });

  const recentQueries = useCommandPaletteStore((s) => s.recentQueries);
  const contextAwareSuggestions = useCommandPaletteStore((s) => s.contextAwareSuggestions);

  const supplementaryRootGroups = useMemo((): CommandPaletteGroup[] | null => {
    if (isBrowsing || currentView !== null || deferredQuery.trim().length > 0) {
      return null;
    }
    const out: CommandPaletteGroup[] = [];
    const rq = recentQueries.slice(0, 6);
    if (rq.length > 0) {
      out.push({
        value: "recent-nl",
        label: "最近自然语言",
        items: rq.map((row, i) => ({
          kind: "action" as const,
          value: `recent-nl:${row.id}:${i}`,
          searchTerms: [row.query],
          title: row.query,
          ...(row.parsedCommand
            ? {
                description:
                  row.parsedCommand.length > 40
                    ? `匹配: ${row.parsedCommand.slice(0, 40)}…`
                    : `匹配: ${row.parsedCommand}`,
              }
            : {}),
          icon: <ClockIcon className={ITEM_ICON_CLASS} />,
          keepOpen: true,
          run: async () => {
            setQuery(row.query);
          },
        })),
      });
    }
    if (contextAwareSuggestions.length > 0) {
      out.push({
        value: "ctx-aware",
        label: "与当前项目上下文相关",
        items: contextAwareSuggestions.map((cmd) => ({
          kind: "action" as const,
          value: `ctx-cmd:${cmd.id}`,
          searchTerms: [cmd.title, ...cmd.keywords],
          title: cmd.title,
          ...(cmd.description ? { description: cmd.description } : {}),
          icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            cmd.action();
            setOpen(false);
          },
        })),
      });
    }
    return out.length > 0 ? out : null;
  }, [
    contextAwareSuggestions,
    currentView,
    deferredQuery,
    isBrowsing,
    recentQueries,
    setOpen,
    setQuery,
  ]);

  let displayedGroups = filteredGroups;
  if (isSshBrowsing) {
    displayedGroups = sshBrowseGroups;
  } else if (isFilesystemBrowsing) {
    displayedGroups = relativePathNeedsActiveProject ? [] : browseGroups;
  } else if (currentView === null && supplementaryRootGroups) {
    displayedGroups = [...supplementaryRootGroups, ...displayedGroups];
  }

  const inputPlaceholder = getCommandPaletteInputPlaceholder(paletteMode, {
    ssh: isSshBrowsing,
  });
  const isSubmenu = paletteMode === "submenu" || paletteMode === "submenu-browse";
  const hasHighlightedBrowseItem =
    (highlightedItemValue?.startsWith("browse:") ||
      highlightedItemValue?.startsWith("ssh-browse:")) ??
    false;
  const canSubmitBrowsePath =
    (isFilesystemBrowsing && !relativePathNeedsActiveProject) || isSshBrowsing;
  const willCreateProjectPath = isSshBrowsing
    ? canSubmitBrowsePath &&
      !sshBrowse.isBrowsePending &&
      query.trim().length > 0 &&
      !hasHighlightedBrowseItem &&
      (hasTrailingSshPathSeparator(query) ? !sshBrowse.browseResult : exactSshBrowseEntry === null)
    : canSubmitBrowsePath &&
      !isBrowsePending &&
      query.trim().length > 0 &&
      !hasHighlightedBrowseItem &&
      (hasTrailingPathSeparator(query) ? !browseResult : exactBrowseEntry === null);
  const useMetaForMod = isMacPlatform(getPlatformString());
  const submitModifierLabel = useMetaForMod ? "\u2318" : "Ctrl";
  const submitActionLabel = willCreateProjectPath ? "创建并添加" : "添加";
  const addShortcutLabel = hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter";
  const fileManagerName = getLocalFileManagerName(getPlatformString());
  const canOpenProjectFromFileManager =
    isFilesystemBrowsing &&
    browseEnvironmentId !== null &&
    primaryEnvironmentId !== null &&
    browseEnvironmentId === primaryEnvironmentId &&
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined;
  const fileManagerInitialPath = useMemo(() => {
    if (!canOpenProjectFromFileManager) {
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return undefined;
    }

    const initialPath = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? trimmedQuery)
      : browseDirectoryPath || trimmedQuery;

    const resolvedPath = resolveProjectPathForDispatch(initialPath, currentProjectCwdForBrowse);
    return resolvedPath.length > 0 ? resolvedPath : undefined;
  }, [
    browseDirectoryPath,
    browseResult?.parentPath,
    canOpenProjectFromFileManager,
    currentProjectCwdForBrowse,
    query,
  ]);

  function isPrimaryModifierPressed(event: KeyboardEvent<HTMLInputElement>): boolean {
    return useMetaForMod ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const shouldSubmitBrowsePath =
      canSubmitBrowsePath &&
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || isPrimaryModifierPressed(event));

    if (shouldSubmitBrowsePath) {
      event.preventDefault();
      if (isSshBrowsing) {
        void handleAddSshProject(resolvedAddSshProjectPath);
      } else {
        void handleAddProject(resolvedAddProjectPath);
      }
      return;
    }

    if (event.key === "Backspace" && query === "" && isSubmenu) {
      event.preventDefault();
      popView();
    }
  }

  function executeItem(item: CommandPaletteActionItem | CommandPaletteSubmenuItem): void {
    if (item.kind === "submenu") {
      pushView(item);
      return;
    }

    if (!item.keepOpen) {
      setOpen(false);
    }

    void item.run().catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "无法执行命令",
          description: error instanceof Error ? error.message : "发生意外错误。",
        }),
      );
    });
  }

  const handleOpenProjectFromFileManager = useCallback(async () => {
    if (!canOpenProjectFromFileManager || isPickingProjectFolder) {
      return;
    }
    const api = readLocalApi();
    if (!api) {
      return;
    }

    setIsPickingProjectFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder(
        fileManagerInitialPath ? { initialPath: fileManagerInitialPath } : undefined,
      );
    } catch {
      // Ignore picker failures and leave the palette open.
      setIsPickingProjectFolder(false);
      return;
    }
    setIsPickingProjectFolder(false);
    if (!pickedPath) {
      return;
    }
    await handleAddProject(pickedPath);
  }, [
    canOpenProjectFromFileManager,
    fileManagerInitialPath,
    handleAddProject,
    isPickingProjectFolder,
  ]);

  return (
    <CommandDialogPopup
      aria-label="Command palette"
      className="overflow-hidden p-0"
      data-testid="command-palette"
      finalFocus={() => {
        composerHandleRef?.current?.focusAtEnd();
        return false;
      }}
    >
      <Command
        key={`${viewStack.length}-${browseGeneration}-${isBrowsing}`}
        aria-label="Command palette"
        autoHighlight={isBrowsing ? false : "always"}
        mode="none"
        onItemHighlighted={(value) => {
          setHighlightedItemValue(typeof value === "string" ? value : null);
        }}
        onValueChange={handleQueryChange}
        value={query}
      >
        <div className="relative">
          <CommandInput
            className={isBrowsing ? (willCreateProjectPath ? "pe-36" : "pe-16") : undefined}
            placeholder={inputPlaceholder}
            wrapperClassName={
              isSubmenu ? "[&_[data-slot=autocomplete-start-addon]]:pointer-events-auto" : undefined
            }
            {...(isSubmenu
              ? {
                  startAddon: (
                    <button
                      type="button"
                      className="flex cursor-pointer items-center"
                      aria-label="返回"
                      onClick={popView}
                    >
                      <ArrowLeftIcon />
                    </button>
                  ),
                }
              : isBrowsing && !isSubmenu
                ? {
                    startAddon: isSshBrowsing ? <ServerIcon /> : <FolderPlusIcon />,
                  }
                : {})}
            onKeyDown={handleKeyDown}
          />
          {isBrowsing ? (
            <Button
              variant="outline"
              size="xs"
              tabIndex={-1}
              className={cn(
                "absolute end-2.5 top-1/2 pe-1 ps-2 -translate-y-1/2",
                hasHighlightedBrowseItem ? "gap-1" : "gap-1.5",
              )}
              aria-label={`${submitActionLabel} (${addShortcutLabel})`}
              disabled={isFilesystemBrowsing && relativePathNeedsActiveProject}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                if (isFilesystemBrowsing && relativePathNeedsActiveProject) {
                  return;
                }
                if (isSshBrowsing) {
                  void handleAddSshProject(resolvedAddSshProjectPath);
                  return;
                }
                void handleAddProject(resolvedAddProjectPath);
              }}
              title={`${submitActionLabel} (${addShortcutLabel})`}
            >
              <span>{submitActionLabel}</span>
              <KbdGroup className="pointer-events-none -me-0.5 items-center gap-1">
                <Kbd>{hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter"}</Kbd>
              </KbdGroup>
            </Button>
          ) : null}
        </div>
        <CommandPanel className="max-h-[min(28rem,70vh)]">
          <CommandPaletteResults
            groups={displayedGroups}
            highlightedItemValue={highlightedItemValue}
            isActionsOnly={isActionsOnly}
            keybindings={keybindings}
            onExecuteItem={executeItem}
            {...(relativePathNeedsActiveProject
              ? { emptyStateMessage: "相对路径需要当前有活动项目。" }
              : isSshBrowsing && sshBrowse.browseErrorMessage
                ? { emptyStateMessage: sshBrowse.browseErrorMessage }
                : willCreateProjectPath
                  ? {
                      emptyStateMessage: "按 Enter 创建此文件夹并添加为项目。",
                    }
                  : {})}
          />
        </CommandPanel>
        <CommandFooter className="gap-3 max-sm:flex-col max-sm:items-start">
          <div className="flex items-center gap-3">
            <KbdGroup className="items-center gap-1.5">
              <Kbd>
                <ArrowUpIcon />
              </Kbd>
              <Kbd>
                <ArrowDownIcon />
              </Kbd>
              <span className={cn("text-muted-foreground/80")}>导航</span>
            </KbdGroup>
            {!canSubmitBrowsePath || hasHighlightedBrowseItem ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Enter</Kbd>
                <span className={cn("text-muted-foreground/80")}>选择</span>
              </KbdGroup>
            ) : null}
            {isSubmenu ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Backspace</Kbd>
                <span className={cn("text-muted-foreground/80")}>返回</span>
              </KbdGroup>
            ) : null}
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Esc</Kbd>
              <span className={cn("text-muted-foreground/80")}>关闭</span>
            </KbdGroup>
          </div>
          {canOpenProjectFromFileManager ? (
            <Button
              variant="ghost"
              size="xs"
              className="h-auto px-2 text-xs text-muted-foreground/80 hover:bg-transparent hover:text-foreground"
              disabled={isPickingProjectFolder}
              onClick={() => {
                void handleOpenProjectFromFileManager();
              }}
            >
              {`在${fileManagerName}中打开`}
            </Button>
          ) : null}
        </CommandFooter>
      </Command>
    </CommandDialogPopup>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tab palette items (Phase 3.4)
// ──────────────────────────────────────────────────────────────────────────────

interface TabPaletteDeps {
  readonly navigate: ReturnType<typeof useNavigate>;
}

/**
 * Build the imperative tab actions (close/merge/split) that share the
 * "actions" group with the existing settings/add-project entries. They only
 * read the live tabs state at execution time so they always operate on what
 * the user sees in the bar at the moment they trigger the action.
 */
function buildTabPaletteActionItems(deps: TabPaletteDeps): CommandPaletteActionItem[] {
  return [
    {
      kind: "action",
      value: "action:tab:close-current",
      searchTerms: ["close tab", "close current tab", "关闭标签", "关闭当前标签"],
      title: "关闭当前标签",
      icon: <XIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "tabs.close",
      run: async () => {
        const store = useUiStateStore.getState();
        const activeId = store.tabs.group.activeTabId;
        if (!activeId) return;
        closeTabsAndSyncRoute({ tabIds: [activeId], navigate: deps.navigate });
      },
    },
    {
      kind: "action",
      value: "action:tab:merge-with-right",
      searchTerms: ["merge tabs", "split", "合并标签", "与右侧合并"],
      title: "合并当前标签与右侧",
      icon: <MergeIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        const store = useUiStateStore.getState();
        const tabs = store.tabs;
        const activeId = tabs.group.activeTabId;
        const candidate = pickAutoMergeCandidate(tabs);
        if (!candidate) return;
        // Prefer merging the active tab with its right neighbour; otherwise
        // fall back to the right-most adjacent merge candidate.
        const idx = activeId ? tabs.group.tabIds.indexOf(activeId) : -1;
        const rightId = idx >= 0 ? tabs.group.tabIds[idx + 1] : undefined;
        if (activeId && rightId) {
          if (store.mergeTabs(activeId, rightId)) return;
        }
        store.mergeTabs(candidate.leftTabId, candidate.rightTabId);
      },
    },
    {
      kind: "action",
      value: "action:tab:split-current",
      searchTerms: ["split", "unmerge", "分离合并", "分离当前合并标签"],
      title: "分离当前合并标签",
      icon: <SplitIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        const store = useUiStateStore.getState();
        const tabs = store.tabs;
        const activeId = tabs.group.activeTabId;
        if (!activeId) return;
        const pair = findMergedPair(tabs.group.mergedPairs, activeId);
        if (!pair) return;
        store.splitMergedTabs(activeId);
      },
    },
  ];
}

/**
 * Build one "Switch to ..." entry per currently open tab. The list updates
 * reactively because we read directly from the store inside the component;
 * the surrounding palette re-renders alongside any tab mutation.
 */
function useTabSwitchPaletteItems(deps: TabPaletteDeps): CommandPaletteActionItem[] {
  const tabsState = useUiStateStore((store) => store.tabs);
  const allTabs = useMemo(
    () =>
      tabsState.group.tabIds.flatMap((id) => {
        const tab = tabsState.tabsById[id];
        return tab ? [tab] : [];
      }),
    [tabsState],
  );

  const groups = useMemo(
    () => buildTabBarItemGroups(allTabs, tabsState.group.mergedPairs),
    [allTabs, tabsState.group.mergedPairs],
  );

  return useMemo(() => {
    const items: CommandPaletteActionItem[] = [];
    let visualIndex = 0;
    for (const group of groups) {
      if (group.kind === "single") {
        const title = resolveTabTitle({ tab: group.tab });
        visualIndex += 1;
        items.push({
          kind: "action",
          value: `action:tab:switch:${group.tab.id}`,
          searchTerms: [title, String(visualIndex), "switch tab", "切换到标签"],
          title: `切换到标签 ${visualIndex}：${title}`,
          icon: <GalleryHorizontalEndIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            await navigateToTabTarget({ tab: group.tab, navigate: deps.navigate });
          },
        });
      } else {
        const leftTitle = resolveTabTitle({ tab: group.leftTab });
        const rightTitle = resolveTabTitle({ tab: group.rightTab });
        const combined = `${leftTitle} ｜ ${rightTitle}`;
        visualIndex += 1;
        items.push({
          kind: "action",
          value: `action:tab:switch:${group.pair.leftTabId}`,
          searchTerms: [leftTitle, rightTitle, String(visualIndex), "merged tab", "切换到标签"],
          title: `切换到标签 ${visualIndex}（合并）：${combined}`,
          icon: <GalleryHorizontalEndIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            await navigateToTabTarget({ tab: group.leftTab, navigate: deps.navigate });
          },
        });
      }
    }
    return items;
  }, [deps.navigate, groups]);
}

async function navigateToTabTarget(args: {
  tab: { id: string; target: import("../uiTabsState").TabTarget };
  navigate: ReturnType<typeof useNavigate>;
}): Promise<void> {
  const { tab, navigate } = args;
  useUiStateStore.getState().activateTab(tab.id);
  if (tab.target.kind === "server") {
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(tab.target.threadRef),
    });
    return;
  }
  if (tab.target.kind === "draft") {
    await navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(tab.target.draftId),
    });
  }
  // 文件标签无路由
}
