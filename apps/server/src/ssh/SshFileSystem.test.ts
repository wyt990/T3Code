import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Client } from "ssh2";

import { makeSshConnectionPoolTestLayer } from "./Layers/SshConnectionPool.ts";
import { SshFileSystemLive } from "./Layers/SshFileSystem.ts";
import { SshFileSystem } from "./Services/SshFileSystem.ts";

const mockClient = {
  destroyed: false,
  sftp: (callback: (error: Error | undefined, sftp?: unknown) => void) => {
    callback(undefined, {
      readdir: (
        path: string,
        cb: (
          error: Error | undefined,
          list?: Array<{
            filename: string;
            attrs: { isDirectory: () => boolean; isSymbolicLink: () => boolean };
          }>,
        ) => void,
      ) => {
        cb(undefined, [
          {
            filename: "src",
            attrs: {
              isDirectory: () => true,
              isSymbolicLink: () => false,
            },
          },
        ]);
        assert.equal(path, "/tmp/project");
      },
      stat: (
        path: string,
        cb: (
          error: Error | undefined,
          attrs?: { isDirectory: () => boolean; size: number },
        ) => void,
      ) => {
        cb(undefined, {
          isDirectory: () => true,
          size: 0,
        });
        assert.equal(path, "/tmp/project/src");
      },
    });
  },
  end: () => undefined,
  on: () => undefined,
  once: () => undefined,
} as unknown as Client;

const TestLayer = it.layer(
  SshFileSystemLive.pipe(
    Layer.provide(
      makeSshConnectionPoolTestLayer({
        clients: {
          "conn-1": mockClient,
        },
      }),
    ),
  ),
);

TestLayer("SshFileSystem", (it) => {
  it.effect("lists and stats remote paths over SFTP", () =>
    Effect.gen(function* () {
      const fileSystem = yield* SshFileSystem;
      const entries = yield* fileSystem.list({
        connectionId: "conn-1",
        path: "/tmp/project",
      });
      assert.equal(entries[0]?.name, "src");
      assert.equal(entries[0]?.type, "directory");

      const stat = yield* fileSystem.stat({
        connectionId: "conn-1",
        path: "/tmp/project/src",
      });
      assert.equal(stat.isDirectory, true);
    }),
  );

  it.effect("list can use the browse lane without sharing workspace SFTP", () =>
    Effect.gen(function* () {
      const fileSystem = yield* SshFileSystem;
      const entries = yield* fileSystem.list({
        connectionId: "conn-1",
        path: "/tmp/project",
        lane: "browse",
      });
      assert.equal(entries[0]?.name, "src");
    }),
  );
});
