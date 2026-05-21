import type { OrchestrationProject, OrchestrationProjectShell } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import { parseOpenEditorTarget } from "../openEditorTargetParse.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
  type WorkspaceExecutionResolverError,
} from "./Services/WorkspaceExecution.ts";

export type ResolveWorkspaceExecutionByCwdError =
  | ProjectionRepositoryError
  | WorkspaceExecutionResolverError;

export const resolveWorkspaceExecutionByCwd = (
  cwd: string,
): Effect.Effect<
  Option.Option<WorkspaceExecution>,
  ResolveWorkspaceExecutionByCwdError,
  ProjectionSnapshotQuery | WorkspaceExecutionResolver
> =>
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const workspaceExecutionResolver = yield* WorkspaceExecutionResolver;

    const projectOption = yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(cwd);
    return yield* resolveWorkspaceExecutionForProject(projectOption, workspaceExecutionResolver);
  });

const normalizeTargetPath = (targetPath: string): string => targetPath.trim().replace(/\\/g, "/");

const findSshProjectShellForTargetPath = (
  pathOnly: string,
  projects: ReadonlyArray<OrchestrationProjectShell>,
): OrchestrationProjectShell | null => {
  let best: OrchestrationProjectShell | null = null;
  let bestRootLength = -1;

  for (const project of projects) {
    if (project.transport.type !== "ssh") {
      continue;
    }
    const root = normalizeTargetPath(project.workspaceRoot).replace(/\/+$/, "") || "/";
    if (pathOnly === root || pathOnly.startsWith(`${root}/`)) {
      if (root.length > bestRootLength) {
        best = project;
        bestRootLength = root.length;
      }
    }
  }

  return best;
};

export const resolveWorkspaceExecutionForTargetPath = (
  targetPath: string,
  deps: {
    readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
    readonly workspaceExecutionResolver: WorkspaceExecutionResolver["Service"];
  },
): Effect.Effect<Option.Option<WorkspaceExecution>, ResolveWorkspaceExecutionByCwdError> =>
  Effect.gen(function* () {
    const pathOnly = parseOpenEditorTarget(targetPath).path;

    const exactOption =
      yield* deps.projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(pathOnly);
    const exactExecution = yield* resolveWorkspaceExecutionForProject(
      exactOption,
      deps.workspaceExecutionResolver,
    );
    if (Option.isSome(exactExecution)) {
      return exactExecution;
    }

    const shell = yield* deps.projectionSnapshotQuery.getShellSnapshot();
    const matched = findSshProjectShellForTargetPath(pathOnly, shell.projects);
    if (matched === null) {
      return Option.none();
    }

    return yield* deps.workspaceExecutionResolver
      .resolveByProjectId(matched.id)
      .pipe(Effect.map(Option.some));
  });

export const resolveWorkspaceExecutionForProject = (
  projectOption: Option.Option<OrchestrationProject>,
  workspaceExecutionResolver: WorkspaceExecutionResolver["Service"],
): Effect.Effect<Option.Option<WorkspaceExecution>, WorkspaceExecutionResolverError> =>
  Option.match(projectOption, {
    onNone: () => Effect.succeed(Option.none()),
    onSome: (project) =>
      project.transport.type !== "ssh"
        ? Effect.succeed(Option.none())
        : workspaceExecutionResolver.resolveByProjectId(project.id).pipe(Effect.map(Option.some)),
  });
