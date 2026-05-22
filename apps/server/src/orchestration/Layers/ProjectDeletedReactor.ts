import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { Cause, Effect, Layer, Option, Stream } from "effect";

import { RemoteProviderProbe } from "../../provider/remoteProviderProbe.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import {
  hasOtherActiveSshProjectsForConnection,
  releaseIdleSshResourceLanesForDeletedProject,
} from "../../ssh/releaseSshResourceLanes.ts";
import { sshConnectionIdForProject } from "../../ssh/Services/SshTurnStartGate.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProjectDeletedReactor,
  type ProjectDeletedReactorShape,
} from "../Services/ProjectDeletedReactor.ts";
import { logCleanupCauseUnlessInterrupted } from "./ThreadDeletionReactor.ts";

type ProjectDeletedEvent = Extract<OrchestrationEvent, { type: "project.deleted" }>;

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionProjects = yield* ProjectionProjectRepository;
  const remoteProviderProbe = yield* RemoteProviderProbe;

  const releaseSshForDeletedProject = (event: ProjectDeletedEvent) =>
    logCleanupCauseUnlessInterrupted({
      effect: Effect.gen(function* () {
        const rowOption = yield* projectionProjects.getById({
          projectId: event.payload.projectId,
        });
        if (Option.isNone(rowOption)) {
          return;
        }
        const connectionId = sshConnectionIdForProject(rowOption.value);
        yield* releaseIdleSshResourceLanesForDeletedProject(event.payload.projectId, connectionId);
        if (connectionId !== undefined) {
          const hasOtherProjects = yield* hasOtherActiveSshProjectsForConnection(
            connectionId,
            event.payload.projectId,
          );
          if (!hasOtherProjects) {
            remoteProviderProbe.invalidate(connectionId);
          }
        }
      }),
      message: "project deletion cleanup skipped SSH lane release",
      subjectId: event.payload.projectId,
    });

  const processProjectDeleted = Effect.fn("processProjectDeleted")(function* (
    event: ProjectDeletedEvent,
  ) {
    yield* releaseSshForDeletedProject(event);
  });

  const processProjectDeletedSafely = (event: ProjectDeletedEvent) =>
    processProjectDeleted(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("project deleted reactor failed to process event", {
          eventType: event.type,
          projectId: event.payload.projectId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processProjectDeletedSafely);

  const start: ProjectDeletedReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "project.deleted") {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProjectDeletedReactorShape;
});

export const ProjectDeletedReactorLive = Layer.effect(ProjectDeletedReactor, make);
