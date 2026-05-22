import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  clearRemoteClaudeBinaryCacheForConnection,
  resolveRemoteClaudeBinaryPath,
  seedRemoteSpawnBinaryCachesFromProbe,
} from "./remoteProviderBinary.ts";
import type { WorkspaceExecution } from "../workspace/Services/WorkspaceExecution.ts";

const makeExecution = (execCalls: Array<string>): WorkspaceExecution => ({
  kind: "ssh",
  workspaceRoot: "/apps/demo",
  sshConnectionId: "conn-seed",
  exec: (input) =>
    Effect.sync(() => {
      execCalls.push(input.command);
      return { stdout: "", stderr: "", exitCode: 1 };
    }),
  spawnInteractive: () => Effect.die("unused"),
  fileSystem: {
    list: () => Effect.die("unused"),
    stat: () => Effect.die("unused"),
    readFileString: () => Effect.die("unused"),
    readFileBytes: () => Effect.die("unused"),
    writeFileString: () => Effect.die("unused"),
    makeDirectory: () => Effect.die("unused"),
  },
  terminal: {
    open: () => Effect.die("unused"),
  },
});

it.effect("seedRemoteSpawnBinaryCachesFromProbe avoids workspace exec for resolve", () =>
  Effect.gen(function* () {
    const execCalls: Array<string> = [];
    clearRemoteClaudeBinaryCacheForConnection("conn-seed");
    seedRemoteSpawnBinaryCachesFromProbe(
      "conn-seed",
      new Map([["claudeAgent", { available: true, binaryPath: "/root/.local/bin/claudecode" }]]),
    );

    const path = yield* resolveRemoteClaudeBinaryPath(makeExecution(execCalls), "claudecode");
    assert.equal(path, "/root/.local/bin/claudecode");
    assert.equal(execCalls.length, 0);
  }),
);
