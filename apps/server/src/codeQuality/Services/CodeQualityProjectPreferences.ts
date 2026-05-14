import type {
  CodeQualityProjectPreferencesValue,
  ThreadTurnStartCodeQualityGate,
} from "@t3tools/contracts";
import { Context, Effect } from "effect";

export interface CodeQualityProjectPreferencesShape {
  readonly getForProject: (projectId: string) => Effect.Effect<CodeQualityProjectPreferencesValue>;
  readonly setForProject: (
    projectId: string,
    value: CodeQualityProjectPreferencesValue,
  ) => Effect.Effect<void>;
  readonly mergeFromTurnStartGate: (
    projectId: string,
    gate: ThreadTurnStartCodeQualityGate,
  ) => Effect.Effect<void>;
}

export class CodeQualityProjectPreferences extends Context.Service<
  CodeQualityProjectPreferences,
  CodeQualityProjectPreferencesShape
>()("t3/codeQuality/Services/CodeQualityProjectPreferences") {}
