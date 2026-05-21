import { Effect } from "effect";

import type { WorkspaceExecutionFileSystem } from "./Services/WorkspaceExecution.ts";

export const unusedWorkspaceExecutionFileSystem = (): WorkspaceExecutionFileSystem => ({
  list: () => Effect.die("unused in test"),
  stat: () => Effect.die("unused in test"),
  readFileString: () => Effect.die("unused in test"),
  readFileBytes: () => Effect.die("unused in test"),
  writeFileString: () => Effect.die("unused in test"),
  makeDirectory: () => Effect.die("unused in test"),
});
