import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../config.ts";
import { CodeQualityProjectPreferencesLive } from "./Layers/CodeQualityProjectPreferences.ts";
import { CodeQualityProjectPreferences } from "./Services/CodeQualityProjectPreferences.ts";

describe("CodeQualityProjectPreferencesLive", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir !== undefined) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("persists gate and min score per project", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-cq-prefs-"));
    const layer = CodeQualityProjectPreferencesLive.pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), tempDir)),
      Layer.provideMerge(NodeServices.layer),
    );
    const program = Effect.gen(function* () {
      const svc = yield* CodeQualityProjectPreferences;
      const d1 = yield* svc.getForProject("p1");
      expect(d1.minScorePerSnippet).toBe(70);
      expect(d1.turnStartGateMode).toBe("off");
      yield* svc.setForProject("p1", {
        turnStartGateMode: "warn",
        minScorePerSnippet: 82,
        checklist: null,
      });
      const d2 = yield* svc.getForProject("p1");
      expect(d2.minScorePerSnippet).toBe(82);
      expect(d2.turnStartGateMode).toBe("warn");
    });
    await Effect.runPromise(program.pipe(Effect.provide(layer)));
    const raw = fs.readFileSync(
      path.join(tempDir, "userdata", "code-quality-project-preferences.json"),
      "utf8",
    );
    expect(raw).toContain("82");
  });
});
