import { describe, expect, it } from "vitest";
import { Effect, Queue, Stream } from "effect";

import type {
  WorkspaceExecution,
  WorkspaceInteractiveProcess,
} from "../../workspace/Services/WorkspaceExecution.ts";
import {
  spawnClaudeCodeProcessOverSsh,
  workspaceInteractiveToSpawnedProcess,
} from "./SshSpawner.ts";

const makeFakeInteractiveProcess = (): {
  readonly process: WorkspaceInteractiveProcess;
  readonly written: Array<string>;
  readonly stdoutQueue: Queue.Queue<string>;
} => {
  const written: Array<string> = [];
  const stdoutQueue = Effect.runSync(Queue.unbounded<string>());
  const exitQueue = Effect.runSync(Queue.unbounded<number>());

  const process: WorkspaceInteractiveProcess = {
    write: (data) =>
      Effect.sync(() => {
        written.push(typeof data === "string" ? data : new TextDecoder().decode(data));
      }),
    stdout: Stream.fromQueue(stdoutQueue),
    stderr: Stream.empty,
    exited: Queue.take(exitQueue),
    kill: () => Queue.offer(exitQueue, 0),
  };

  return { process, written, stdoutQueue };
};

describe("workspaceInteractiveToSpawnedProcess", () => {
  it("forwards stdin writes to the interactive process", async () => {
    const { process, written } = makeFakeInteractiveProcess();
    const spawned = workspaceInteractiveToSpawnedProcess(process);

    spawned.stdin.write("hello");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(written).toEqual(["hello"]);
    spawned.kill("SIGTERM");
  });

  it("pipes interactive stdout to spawned stdout", async () => {
    const { process, stdoutQueue } = makeFakeInteractiveProcess();
    const spawned = workspaceInteractiveToSpawnedProcess(process);
    const chunks: Array<string> = [];

    spawned.stdout.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });

    await Effect.runPromise(Queue.offer(stdoutQueue, "line-1"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(chunks.join("")).toContain("line-1");
    spawned.kill("SIGTERM");
  });
});

describe("spawnClaudeCodeProcessOverSsh", () => {
  it("returns immediately and forwards stdin after async spawn completes", async () => {
    const { process, written } = makeFakeInteractiveProcess();
    const execution: WorkspaceExecution = {
      kind: "ssh",
      workspaceRoot: "/apps/claude-code",
      sshConnectionId: "conn-1",
      spawnInteractive: () => Effect.promise(async () => process),
      exec: () => Effect.die("unused"),
      fileSystem: {
        list: () => Effect.die("unused"),
        stat: () => Effect.die("unused"),
        readFileString: () => Effect.die("unused"),
        readFileBytes: () => Effect.die("unused"),
        writeFileString: () => Effect.die("unused"),
        makeDirectory: () => Effect.die("unused"),
        unlink: () => Effect.die("unused"),
        rmdir: () => Effect.die("unused"),
        rename: () => Effect.die("unused"),
      },
      terminal: { open: () => Effect.die("unused") },
    };

    const spawned = spawnClaudeCodeProcessOverSsh(
      execution,
      { CLAUDE_CODE_ENTRYPOINT: "sdk-ts" },
      {
        command: "/root/.local/bin/claudecode",
        args: ["--sdk"],
        cwd: "/apps/claude-code",
        env: {},
        signal: new AbortController().signal,
      },
    );

    // Claude Agent SDK registers listeners synchronously during initialize.
    expect(() => {
      spawned.on("error", () => {});
      spawned.on("exit", () => {});
    }).not.toThrow();

    spawned.stdin.write("ping");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(written).toEqual(["ping"]);
    spawned.kill("SIGTERM");
  });
});
