import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Option } from "effect";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SshConnectionPool } from "./Services/SshConnectionPool.ts";
import { SshTurnStartGate, sshConnectionIdForProject } from "./Services/SshTurnStartGate.ts";
import type { SshConnectionLane } from "./sshConnectionLane.ts";

/** SSH lanes used by chat, terminals, and remote git; closed when idle (refCount 0). */
export const SSH_SESSION_RESOURCE_LANES = [
  "workspace",
  "interactive",
  "git",
] as const satisfies ReadonlyArray<SshConnectionLane>;

const SSH_AUXILIARY_IDLE_LANES = [
  "browse",
  "probe",
] as const satisfies ReadonlyArray<SshConnectionLane>;

export const releaseIdleSshResourceLanes = (connectionId: string) =>
  Effect.gen(function* () {
    const pool = yield* SshConnectionPool;
    const turnStartGate = yield* SshTurnStartGate;
    yield* turnStartGate.invalidate(connectionId);
    yield* Effect.forEach(
      SSH_SESSION_RESOURCE_LANES,
      (lane) => pool.releaseIdleLane(connectionId, lane),
      { discard: true },
    );
  });

export const releaseIdleSshAuxiliaryLanes = (connectionId: string) =>
  Effect.gen(function* () {
    const pool = yield* SshConnectionPool;
    yield* Effect.forEach(
      SSH_AUXILIARY_IDLE_LANES,
      (lane) => pool.releaseIdleLane(connectionId, lane),
      { discard: true },
    );
  });

export const releaseIdleSshGitLaneForCwd = (cwd: string) =>
  Effect.gen(function* () {
    const query = yield* ProjectionSnapshotQuery;
    const projectOption = yield* query.getActiveProjectByWorkspaceRoot(cwd);
    if (Option.isNone(projectOption)) {
      return;
    }
    const connectionId = sshConnectionIdForProject(projectOption.value);
    if (connectionId === undefined) {
      return;
    }
    const pool = yield* SshConnectionPool;
    yield* pool.releaseIdleLane(connectionId, "git");
  });

export const hasOtherActiveSshProjectsForConnection = (
  connectionId: string,
  excludingProjectId: ProjectId,
) =>
  Effect.gen(function* () {
    const query = yield* ProjectionSnapshotQuery;
    const shell = yield* query.getShellSnapshot();
    return shell.projects.some(
      (project) =>
        project.deletedAt === null &&
        project.id !== excludingProjectId &&
        project.transport.type === "ssh" &&
        project.transport.sshConnectionId === connectionId,
    );
  });

export const releaseIdleSshResourceLanesForThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const query = yield* ProjectionSnapshotQuery;
    const threadOption = yield* query.getThreadShellById(threadId);
    if (Option.isNone(threadOption)) {
      return;
    }
    const projectOption = yield* query.getProjectShellById(threadOption.value.projectId);
    if (Option.isNone(projectOption)) {
      return;
    }
    const connectionId = sshConnectionIdForProject(projectOption.value);
    if (connectionId === undefined) {
      return;
    }
    yield* releaseIdleSshResourceLanes(connectionId);
  });

export const releaseIdleSshResourceLanesForDeletedProject = (
  projectId: ProjectId,
  connectionId: string | undefined,
) =>
  Effect.gen(function* () {
    if (connectionId === undefined) {
      return;
    }
    const hasOtherProjects = yield* hasOtherActiveSshProjectsForConnection(connectionId, projectId);
    yield* releaseIdleSshResourceLanes(connectionId);
    if (!hasOtherProjects) {
      yield* releaseIdleSshAuxiliaryLanes(connectionId);
    }
  });
