import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";

import { ServerConfig } from "../config.ts";
import { SshConnectionRegistryLive } from "./Layers/SshConnectionRegistry.ts";
import { SshConnectionRegistry } from "./Services/SshConnectionRegistry.ts";

const TestLayer = it.layer(
  SshConnectionRegistryLive.pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ssh-registry-test-" })),
    Layer.provideMerge(NodeServices.layer),
  ),
);

TestLayer("SshConnectionRegistry", (it) => {
  it.effect("upserts and deletes connections", () =>
    Effect.gen(function* () {
      const registry = yield* SshConnectionRegistry;

      const created = yield* registry.upsert({
        host: "example.com",
        username: "user",
        authType: "password",
        label: "Example",
      });
      assert.equal(created.host, "example.com");
      assert.equal(created.authType, "password");

      const listed = yield* registry.list();
      assert.equal(listed.length, 1);

      yield* registry.delete(created.id);
      const afterDelete = yield* registry.list();
      assert.equal(afterDelete.length, 0);
    }),
  );
});
