import { Effect } from "effect";
import * as AcpError from "effect-acp/errors";

import type { WorkspaceInteractiveProcess } from "../workspace/Services/WorkspaceExecution.ts";
import { makeWorkspaceInteractiveStdio } from "./codexWorkspaceStdio.ts";

export { makeWorkspaceInteractiveStdio };

export const makeWorkspaceInteractiveTerminationErrorForAcp = (
  process: WorkspaceInteractiveProcess,
): Effect.Effect<AcpError.AcpError> =>
  Effect.match(process.exited, {
    onFailure: (cause) =>
      new AcpError.AcpTransportError({
        detail: "Failed to determine ACP process exit status",
        cause,
      }),
    onSuccess: (code) => new AcpError.AcpProcessExitedError({ code }),
  });
