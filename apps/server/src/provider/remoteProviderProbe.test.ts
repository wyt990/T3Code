import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref } from "effect";

import { ServerSettingsService } from "../serverSettings.ts";
import { SshProcessRunner } from "../ssh/Services/SshProcessRunner.ts";
import {
  RemoteProviderProbe,
  RemoteProviderProbeLive,
  refreshRemoteClaudeModelsForConnection,
} from "./remoteProviderProbe.ts";

const execCalls: Array<string> = [];

const ProbeTestLayer = it.layer(
  RemoteProviderProbeLive.pipe(
    Layer.provideMerge(
      Layer.succeed(SshProcessRunner, {
        exec: ({ command }) =>
          Effect.sync(() => {
            execCalls.push(command);
            if (command.includes("command -v") || command.includes("which")) {
              if (command.includes("claudecode") || command.includes("claude")) {
                return {
                  stdout: "/usr/bin/claudecode\n",
                  stderr: "",
                  exitCode: 0,
                };
              }
              if (command.includes("opencode")) {
                return {
                  stdout: "/usr/bin/opencode\n",
                  stderr: "",
                  exitCode: 0,
                };
              }
            }
            if (command.includes("--list-models")) {
              return {
                stdout: JSON.stringify({
                  provider: "firstParty",
                  currentModel: "claude-sonnet-4-6",
                  defaultModel: "claude-sonnet-4-6",
                  builtinModels: [],
                  customModels: [{ id: "custom-1", source: "env" }],
                }),
                stderr: "",
                exitCode: 0,
              };
            }
            if (command.includes("--version") || command.includes("-v")) {
              return {
                stdout: "2.1.111\n",
                stderr: "",
                exitCode: 0,
              };
            }
            return {
              stdout: "",
              stderr: "",
              exitCode: 0,
            };
          }),
        spawnInteractive: () => Effect.die("unused in remoteProviderProbe test"),
      }),
    ),
    Layer.provide(
      ServerSettingsService.layerTest({
        providers: {
          codex: { enabled: true, binaryPath: "codex", customModels: [], homePath: "" },
          claudeAgent: {
            enabled: true,
            binaryPath: "claudecode",
            customModels: [],
            launchArgs: "",
          },
          cursor: { enabled: false, binaryPath: "agent" },
          opencode: {
            enabled: true,
            binaryPath: "opencode",
          },
        },
      }),
    ),
  ),
);

ProbeTestLayer("RemoteProviderProbe", (it) => {
  it.effect("probeConnection resolves remote claude and opencode binaries", () =>
    Effect.gen(function* () {
      execCalls.length = 0;
      const probe = yield* RemoteProviderProbe;
      const results = yield* probe.probeConnection("conn-1");
      const claude = results.get("claudeAgent");
      const opencode = results.get("opencode");
      assert.strictEqual(claude?.available, true);
      assert.strictEqual(claude?.binaryPath, "/usr/bin/claudecode");
      assert.strictEqual(opencode?.available, true);
      assert.strictEqual(opencode?.binaryPath, "/usr/bin/opencode");
      assert.strictEqual(
        execCalls.some((call) => call.includes("--list-models")),
        false,
      );
      const models = yield* refreshRemoteClaudeModelsForConnection({
        connectionId: "conn-1",
        binaryPath: "/usr/bin/claudecode",
        version: "2.1.111",
      });
      assert.ok(models.length > 0);
      assert.strictEqual(
        execCalls.some((call) => call.includes("--list-models")),
        true,
      );
    }),
  );

  it.effect("refresh keeps prior cache when list-models exits non-zero", () =>
    Effect.gen(function* () {
      let listModelsCalls = 0;
      const probe = yield* RemoteProviderProbe;
      yield* probe.probeConnection("conn-fail-cache");

      const good = yield* refreshRemoteClaudeModelsForConnection({
        connectionId: "conn-fail-cache",
        binaryPath: "/usr/bin/claudecode",
        version: "2.1.111",
      });
      assert.ok(good.some((model) => model.slug === "custom-1"));

      const FailLayer = RemoteProviderProbeLive.pipe(
        Layer.provideMerge(
          Layer.succeed(SshProcessRunner, {
            exec: ({ command }) =>
              Effect.sync(() => {
                if (command.includes("--list-models")) {
                  listModelsCalls += 1;
                  return {
                    stdout: "",
                    stderr: "error: Cannot find module 'src/utils/privacyLevel.js'\n",
                    exitCode: 1,
                  };
                }
                return { stdout: "", stderr: "", exitCode: 0 };
              }),
            spawnInteractive: () => Effect.die("unused"),
          }),
        ),
        Layer.provide(
          ServerSettingsService.layerTest({
            providers: {
              codex: { enabled: true, binaryPath: "codex", customModels: [], homePath: "" },
              claudeAgent: {
                enabled: true,
                binaryPath: "claudecode",
                customModels: [],
                launchArgs: "",
              },
              cursor: { enabled: false, binaryPath: "agent" },
              opencode: { enabled: true, binaryPath: "opencode" },
            },
          }),
        ),
      );

      const afterFail = yield* refreshRemoteClaudeModelsForConnection({
        connectionId: "conn-fail-cache",
        binaryPath: "/usr/bin/claudecode",
        version: "2.1.111",
      }).pipe(Effect.provide(FailLayer));

      assert.ok(afterFail.some((model) => model.slug === "custom-1"));
      assert.strictEqual(listModelsCalls, 1);
      assert.deepStrictEqual(
        probe.getClaudeModels("conn-fail-cache")?.map((model) => model.slug),
        ["custom-1"],
      );
    }),
  );

  it.effect("coalesces concurrent probeConnection for the same connection", () =>
    Effect.gen(function* () {
      execCalls.length = 0;
      const releaseFirstExec = yield* Deferred.make<void>();
      const execStarted = yield* Ref.make(0);

      const SlowLayer = RemoteProviderProbeLive.pipe(
        Layer.provideMerge(
          Layer.succeed(SshProcessRunner, {
            exec: ({ command }) =>
              Effect.gen(function* () {
                const started = yield* Ref.updateAndGet(execStarted, (n) => n + 1);
                if (started === 1) {
                  yield* Deferred.await(releaseFirstExec);
                }
                execCalls.push(command);
                if (command.includes("command -v") || command.includes("which")) {
                  if (command.includes("claudecode") || command.includes("claude")) {
                    return {
                      stdout: "/usr/bin/claudecode\n",
                      stderr: "",
                      exitCode: 0,
                    };
                  }
                  if (command.includes("opencode")) {
                    return {
                      stdout: "/usr/bin/opencode\n",
                      stderr: "",
                      exitCode: 0,
                    };
                  }
                }
                if (command.includes("--version") || command.includes("-v")) {
                  return { stdout: "2.1.111\n", stderr: "", exitCode: 0 };
                }
                return { stdout: "", stderr: "", exitCode: 0 };
              }),
            spawnInteractive: () => Effect.die("unused"),
          }),
        ),
        Layer.provide(
          ServerSettingsService.layerTest({
            providers: {
              codex: { enabled: true, binaryPath: "codex", customModels: [], homePath: "" },
              claudeAgent: {
                enabled: true,
                binaryPath: "claudecode",
                customModels: [],
                launchArgs: "",
              },
              cursor: { enabled: false, binaryPath: "agent" },
              opencode: { enabled: true, binaryPath: "opencode" },
            },
          }),
        ),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const probe = yield* RemoteProviderProbe;
          const firstFiber = yield* probe.probeConnection("conn-coalesce").pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          assert.strictEqual(yield* Ref.get(execStarted), 1);

          const secondFiber = yield* probe.probeConnection("conn-coalesce").pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          assert.strictEqual(yield* Ref.get(execStarted), 1);

          yield* Deferred.succeed(releaseFirstExec, undefined);
          const first = yield* Fiber.join(firstFiber);
          const second = yield* Fiber.join(secondFiber);

          assert.strictEqual(first.get("claudeAgent")?.available, true);
          assert.strictEqual(second.get("claudeAgent")?.available, true);
          assert.deepStrictEqual(first, second);
        }).pipe(Effect.provide(SlowLayer)),
      );
    }),
  );

  it.effect("invalidate clears probe cache but keeps model lists by default", () =>
    Effect.gen(function* () {
      const probe = yield* RemoteProviderProbe;
      yield* probe.probeConnection("conn-1");
      const modelsBefore = probe.getClaudeModels("conn-1");
      assert.strictEqual(probe.getProbes("conn-1") !== undefined, true);
      assert.ok(modelsBefore && modelsBefore.length > 0);
      probe.invalidate("conn-1");
      assert.strictEqual(probe.getProbes("conn-1"), undefined);
      assert.deepStrictEqual(probe.getClaudeModels("conn-1"), modelsBefore);
      probe.invalidate("conn-1", { clearModels: true });
      assert.strictEqual(probe.getClaudeModels("conn-1"), undefined);
    }),
  );
});
