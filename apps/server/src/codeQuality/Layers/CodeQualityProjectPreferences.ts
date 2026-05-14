import {
  CodeQualityProjectPreferencesValue,
  type ThreadTurnStartCodeQualityGate,
} from "@t3tools/contracts";
import { Effect, Exit, FileSystem, Layer, Path, Ref, Schema } from "effect";

import { ServerConfig } from "../../config.ts";
import {
  CodeQualityProjectPreferences,
  type CodeQualityProjectPreferencesShape,
} from "../Services/CodeQualityProjectPreferences.ts";

const FILE_NAME = "code-quality-project-preferences.json";

const defaultPreferences = (): typeof CodeQualityProjectPreferencesValue.Type => ({
  turnStartGateMode: "off",
  minScorePerSnippet: 70,
  checklist: null,
});

const clampScore = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

const FileShape = Schema.Struct({
  version: Schema.Literal(1),
  projects: Schema.Record(Schema.String, CodeQualityProjectPreferencesValue),
});

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const pathMod = yield* Path.Path;
  const config = yield* ServerConfig;
  const filePath = pathMod.join(config.stateDir, FILE_NAME);
  const cacheRef = yield* Ref.make(
    new Map<string, typeof CodeQualityProjectPreferencesValue.Type>(),
  );

  const readDisk = Effect.gen(function* () {
    const exists = yield* fs.exists(filePath);
    if (!exists) {
      return;
    }
    const raw = yield* fs
      .readFileString(filePath)
      .pipe(Effect.catch(() => Effect.succeed("" as string)));
    if (raw.length === 0) {
      return;
    }
    const parsed = yield* Effect.sync((): unknown => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    });
    if (parsed === null) {
      return;
    }
    const exit = Schema.decodeUnknownExit(FileShape)(parsed);
    if (!Exit.isSuccess(exit)) {
      return;
    }
    yield* Ref.set(cacheRef, new Map(Object.entries(exit.value.projects)));
  });

  yield* readDisk;

  const flush = Effect.gen(function* () {
    const map = yield* Ref.get(cacheRef);
    const projects = Object.fromEntries(map);
    const body = JSON.stringify({ version: 1 as const, projects }, null, 2);
    yield* fs
      .writeFileString(filePath, body)
      .pipe(
        Effect.catch(() =>
          Effect.logWarning("code quality project preferences: write failed", { filePath }),
        ),
      );
  });

  const getForProject: CodeQualityProjectPreferencesShape["getForProject"] = (projectId) =>
    Effect.gen(function* () {
      const map = yield* Ref.get(cacheRef);
      return map.get(projectId) ?? defaultPreferences();
    });

  const setForProject: CodeQualityProjectPreferencesShape["setForProject"] = (projectId, value) =>
    Effect.gen(function* () {
      const normalized: typeof CodeQualityProjectPreferencesValue.Type = {
        turnStartGateMode: value.turnStartGateMode,
        minScorePerSnippet: clampScore(value.minScorePerSnippet),
        checklist: value.checklist,
      };
      const map = yield* Ref.get(cacheRef);
      const next = new Map(map);
      next.set(projectId, normalized);
      yield* Ref.set(cacheRef, next);
      yield* flush;
    });

  const mergeFromTurnStartGate: CodeQualityProjectPreferencesShape["mergeFromTurnStartGate"] = (
    projectId,
    gate: ThreadTurnStartCodeQualityGate,
  ) =>
    Effect.gen(function* () {
      const current = yield* getForProject(projectId);
      const next: typeof CodeQualityProjectPreferencesValue.Type = {
        turnStartGateMode: gate.mode,
        minScorePerSnippet: clampScore(gate.minScorePerSnippet ?? current.minScorePerSnippet),
        checklist: current.checklist,
      };
      yield* setForProject(projectId, next);
    });

  return {
    getForProject,
    setForProject,
    mergeFromTurnStartGate,
  } satisfies CodeQualityProjectPreferencesShape;
});

export const CodeQualityProjectPreferencesLive = Layer.effect(CodeQualityProjectPreferences, make);
