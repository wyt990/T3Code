import { CommandId, ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { ServerConfig } from "../config.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";

const TestLayer = it.layer(
  WorkspacePathsLive.pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-normalizer-test-" })),
    Layer.provideMerge(NodeServices.layer),
  ),
);

TestLayer("normalizeDispatchCommand", (it) => {
  it.effect("skips local filesystem checks for ssh project.create", () =>
    Effect.gen(function* () {
      const normalized = yield* normalizeDispatchCommand({
        type: "project.create",
        commandId: CommandId.make("cmd-1"),
        projectId: ProjectId.make("project-ssh"),
        title: "Remote",
        workspaceRoot: "/home/user/repo",
        transport: { type: "ssh", sshConnectionId: "conn-1" },
        createWorkspaceRootIfMissing: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      assert.equal(normalized.type, "project.create");
      if (normalized.type !== "project.create") {
        return;
      }
      assert.equal(normalized.workspaceRoot, "/home/user/repo");
      assert.isDefined(normalized.transport);
      if (!normalized.transport) {
        return;
      }
      assert.equal(normalized.transport.type, "ssh");
      assert.equal(normalized.createWorkspaceRootIfMissing, false);
    }),
  );
});
