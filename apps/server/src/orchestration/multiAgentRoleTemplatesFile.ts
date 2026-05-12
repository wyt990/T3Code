import { Effect, FileSystem, Path, Schema } from "effect";
import {
  MultiAgentRoleTemplate as MultiAgentRoleTemplateSchema,
  type MultiAgentRoleTemplate,
  type MultiAgentRoleTemplateUpsert,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";

const FILE_NAME = "multi-agent-role-templates.json";

const FileShape = Schema.Struct({
  templates: Schema.Array(MultiAgentRoleTemplateSchema),
});

function isPresetId(id: string): boolean {
  return id.startsWith("preset:");
}

export const PRESET_MULTI_AGENT_ROLE_TEMPLATES: readonly MultiAgentRoleTemplate[] = [
  {
    id: "preset:architect",
    role: "architect",
    name: "架构师",
    instructions: "聚焦模块边界、接口契约与可演进性；先给出结构化方案与权衡，再交由编码角色实现。",
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "preset:coder",
    role: "coder",
    name: "编码者",
    instructions: "在既定方案下实现代码；保持改动可审、可测，并遵守项目现有风格与工具链。",
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "preset:reviewer",
    role: "reviewer",
    name: "审查者",
    instructions: "从正确性、安全与可维护性审查变更；指出具体问题并给出可操作的修改建议。",
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "preset:tester",
    role: "tester",
    name: "测试者",
    instructions: "设计覆盖关键路径的测试；关注回归、边界与失败模式，并说明如何运行验证。",
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "preset:doc-writer",
    role: "doc-writer",
    name: "文档编写",
    instructions: "将设计与使用方式写成清晰文档；面向读者组织目录、示例与常见问题。",
    createdAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "preset:custom",
    role: "custom",
    name: "自定义（基线）",
    instructions: "根据任务说明与共享上下文自主拆解步骤并执行；产出应可被下一任务消费。",
    createdAt: "1970-01-01T00:00:00.000Z",
  },
];

export const readCustomRoleTemplates = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const pathMod = yield* Path.Path;
  const config = yield* ServerConfig;
  const filePath = pathMod.join(config.stateDir, FILE_NAME);
  const exists = yield* fs.exists(filePath);
  if (!exists) {
    return [] as MultiAgentRoleTemplate[];
  }
  const raw = yield* fs
    .readFileString(filePath)
    .pipe(Effect.mapError((e) => new Error(`read role templates: ${e.message}`)));
  const parsed = yield* Effect.sync((): unknown | null => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  });
  if (parsed === null) {
    return [] as MultiAgentRoleTemplate[];
  }
  const decoded = Schema.decodeUnknownExit(FileShape)(parsed);
  if (decoded._tag === "Failure") {
    return [] as MultiAgentRoleTemplate[];
  }
  return decoded.value.templates.filter((t: MultiAgentRoleTemplate) => !isPresetId(t.id));
}).pipe(Effect.catch(() => Effect.succeed([] as MultiAgentRoleTemplate[])));

export const writeCustomRoleTemplates = (templates: MultiAgentRoleTemplate[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathMod = yield* Path.Path;
    const config = yield* ServerConfig;
    const filePath = pathMod.join(config.stateDir, FILE_NAME);
    const body = JSON.stringify({ templates }, null, 2);
    yield* fs
      .writeFileString(filePath, body)
      .pipe(Effect.mapError((e) => new Error(`write role templates: ${e.message}`)));
  });

export const listMergedRoleTemplates = Effect.gen(function* () {
  const custom = yield* readCustomRoleTemplates;
  return [...PRESET_MULTI_AGENT_ROLE_TEMPLATES, ...custom];
});

export const upsertCustomRoleTemplate = (input: MultiAgentRoleTemplateUpsert) =>
  Effect.gen(function* () {
    if (isPresetId(input.id)) {
      return yield* Effect.fail(new Error("cannot upsert preset template id"));
    }
    const custom = yield* readCustomRoleTemplates;
    const existing = custom.find((t) => t.id === input.id);
    const next: MultiAgentRoleTemplate = {
      id: input.id,
      role: input.role,
      name: input.name,
      instructions: input.instructions,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const without = custom.filter((t) => t.id !== input.id);
    yield* writeCustomRoleTemplates([...without, next]);
    return next;
  });

export const deleteCustomRoleTemplate = (id: string) =>
  Effect.gen(function* () {
    if (isPresetId(id)) {
      return yield* Effect.fail(new Error("cannot delete preset template"));
    }
    const custom = yield* readCustomRoleTemplates;
    yield* writeCustomRoleTemplates(custom.filter((t) => t.id !== id));
  });
