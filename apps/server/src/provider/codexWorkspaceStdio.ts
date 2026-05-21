import { Effect, Sink, Stream } from "effect";
import * as Stdio from "effect/Stdio";
import * as CodexError from "effect-codex-app-server/errors";

import type { WorkspaceInteractiveProcess } from "../workspace/Services/WorkspaceExecution.ts";

const encoder = new TextEncoder();

/** Adapts a workspace interactive process (local or SSH) to Codex App Server stdio. */
export const makeWorkspaceInteractiveStdio = (process: WorkspaceInteractiveProcess) =>
  Stdio.make({
    args: Effect.succeed([]),
    stdin: process.stdout.pipe(
      Stream.map((chunk) => encoder.encode(chunk)),
      Stream.catch(() => Stream.empty),
    ),
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        process
          .write(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
          .pipe(Effect.catch(() => Effect.void)),
      ),
    stderr: () => Sink.drain,
  });

export const makeWorkspaceInteractiveTerminationError = (
  process: WorkspaceInteractiveProcess,
): Effect.Effect<CodexError.CodexAppServerError> =>
  Effect.match(process.exited, {
    onFailure: (cause) =>
      new CodexError.CodexAppServerTransportError({
        detail: "Failed to determine Codex App Server process exit status",
        cause,
      }),
    onSuccess: (code) => new CodexError.CodexAppServerProcessExitedError({ code }),
  });
