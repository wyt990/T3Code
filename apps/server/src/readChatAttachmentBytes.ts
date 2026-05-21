import * as nodePath from "node:path";

import type { ChatAttachment } from "@t3tools/contracts";
import { Effect, FileSystem } from "effect";

import {
  normalizeWorkspaceAttachmentRelativePath,
  resolveAttachmentPath,
} from "./attachmentStore.ts";
import { formatSshUserMessage } from "./ssh/formatSshUserMessage.ts";
import type { WorkspaceExecution } from "./workspace/Services/WorkspaceExecution.ts";
import { resolveRelativePathWithinPosixRoot } from "./workspace/posixPaths.ts";

export type ReadChatAttachmentBytesError = {
  readonly message: string;
  readonly cause?: unknown;
};

const mapWorkspaceExecutionError = (cause: unknown): ReadChatAttachmentBytesError => ({
  message: formatSshUserMessage(cause),
  cause,
});

export const readChatAttachmentBytes = (input: {
  readonly attachment: ChatAttachment;
  readonly attachmentsDir: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly workspaceRoot?: string | undefined;
  readonly workspaceExecution?: WorkspaceExecution | undefined;
}): Effect.Effect<Uint8Array, ReadChatAttachmentBytesError> =>
  Effect.gen(function* () {
    const workspaceRelativePath =
      input.attachment.type === "image" ? input.attachment.workspaceRelativePath : undefined;
    const normalizedWorkspacePath =
      workspaceRelativePath === undefined
        ? null
        : normalizeWorkspaceAttachmentRelativePath(workspaceRelativePath);

    if (normalizedWorkspacePath !== null) {
      if (input.workspaceExecution !== undefined) {
        const resolved = resolveRelativePathWithinPosixRoot({
          workspaceRoot: input.workspaceExecution.workspaceRoot,
          relativePath: normalizedWorkspacePath,
        });
        if ("outsideRoot" in resolved) {
          return yield* Effect.fail({
            message: `Workspace attachment path is outside project root: '${workspaceRelativePath}'.`,
          });
        }
        return yield* input.workspaceExecution.fileSystem
          .readFileBytes(resolved.absolutePath)
          .pipe(Effect.mapError(mapWorkspaceExecutionError));
      }

      if (input.workspaceRoot !== undefined && input.workspaceRoot.trim().length > 0) {
        const root = nodePath.resolve(input.workspaceRoot.trim());
        const absolutePath = nodePath.resolve(root, normalizedWorkspacePath);
        const relativeToRoot = nodePath.relative(root, absolutePath);
        if (
          relativeToRoot.startsWith("..") ||
          nodePath.isAbsolute(relativeToRoot) ||
          relativeToRoot.length === 0
        ) {
          return yield* Effect.fail({
            message: `Workspace attachment path is outside project root: '${workspaceRelativePath}'.`,
          });
        }
        return yield* input.fileSystem.readFile(absolutePath).pipe(
          Effect.mapError((cause) => ({
            message: cause instanceof Error ? cause.message : "Failed to read workspace file.",
            cause,
          })),
        );
      }

      return yield* Effect.fail({
        message: `Workspace attachment '${input.attachment.name}' requires an active project workspace.`,
      });
    }

    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment: input.attachment,
    });
    if (!attachmentPath) {
      return yield* Effect.fail({
        message: `Invalid attachment id '${input.attachment.id}'.`,
      });
    }

    return yield* input.fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError((cause) => ({
        message: cause instanceof Error ? cause.message : "Failed to read attachment file.",
        cause,
      })),
    );
  }).pipe(Effect.provideService(FileSystem.FileSystem, input.fileSystem));
