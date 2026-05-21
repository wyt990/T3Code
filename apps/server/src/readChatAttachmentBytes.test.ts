import { assert, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { readChatAttachmentBytes } from "./readChatAttachmentBytes.ts";
import type { WorkspaceExecution } from "./workspace/Services/WorkspaceExecution.ts";

const remoteRoot = "/home/user/repo";
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

const makeRemoteExecution = (): WorkspaceExecution => ({
  kind: "ssh",
  workspaceRoot: remoteRoot,
  sshConnectionId: "conn-attach",
  spawnInteractive: () => Effect.die("unused"),
  exec: () => Effect.die("unused"),
  fileSystem: {
    list: () => Effect.die("unused"),
    stat: () => Effect.die("unused"),
    readFileString: () => Effect.die("unused"),
    readFileBytes: (targetPath) =>
      targetPath === `${remoteRoot}/assets/diagram.png`
        ? Effect.succeed(pngBytes)
        : Effect.die(`unexpected read: ${targetPath}`),
    writeFileString: () => Effect.die("unused"),
    makeDirectory: () => Effect.die("unused"),
  },
  terminal: {
    open: () => Effect.die("unused"),
  },
});

it("reads workspace-relative images over SSH as raw bytes", () =>
  Effect.gen(function* () {
    const bytes = yield* readChatAttachmentBytes({
      attachment: {
        type: "image",
        id: "thread-abc-12345678-1234-1234-1234-123456789abc",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: pngBytes.byteLength,
        workspaceRelativePath: "assets/diagram.png",
      },
      attachmentsDir: "/tmp/attachments",
      fileSystem: {
        readFile: () =>
          Effect.die("local fileSystem should not be used for SSH workspace attachments"),
      } as unknown as FileSystem.FileSystem,
      workspaceExecution: makeRemoteExecution(),
    });
    assert.deepEqual(bytes, pngBytes);
  }));

it("rejects workspace-relative paths that escape the project root", () =>
  Effect.gen(function* () {
    const error = yield* readChatAttachmentBytes({
      attachment: {
        type: "image",
        id: "thread-abc-12345678-1234-1234-1234-123456789abc",
        name: "secret.png",
        mimeType: "image/png",
        sizeBytes: 1,
        workspaceRelativePath: "../outside.png",
      },
      attachmentsDir: "/tmp/attachments",
      fileSystem: {
        readFile: () => Effect.die("unused"),
      } as unknown as FileSystem.FileSystem,
      workspaceExecution: makeRemoteExecution(),
    }).pipe(Effect.flip);
    assert.include(error.message, "outside project root");
  }));
