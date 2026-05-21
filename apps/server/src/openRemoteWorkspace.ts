import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { OpenError } from "@t3tools/contracts";
import { Effect } from "effect";

import { formatOpenEditorTarget, parseOpenEditorTarget } from "./openEditorTargetParse.ts";
import { formatSshUserMessage } from "./ssh/formatSshUserMessage.ts";
import type { WorkspaceExecution } from "./workspace/Services/WorkspaceExecution.ts";
import { basenamePosix, joinPosix, relativePosixPathWithinRoot } from "./workspace/posixPaths.ts";

const sanitizeTempRelativePath = (relativePath: string): string =>
  relativePath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");

const remoteOpenTempDir = (execution: WorkspaceExecution): string => {
  const key = execution.sshConnectionId ?? execution.workspaceRoot;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return join(tmpdir(), "t3code-remote-open", hash);
};

const toOpenError = (message: string, cause?: unknown): OpenError =>
  new OpenError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });

/**
 * Downloads a remote workspace file to a local temp path for editor launch.
 * Line/column suffixes are preserved for goto-style editors on the local temp file.
 */
export const materializeRemoteOpenTarget = (
  target: string,
  execution: WorkspaceExecution,
): Effect.Effect<string, OpenError> =>
  Effect.gen(function* () {
    const parsed = parseOpenEditorTarget(target);
    const root = execution.workspaceRoot.replace(/\/+$/, "") || "/";
    const absoluteRemote = parsed.path.startsWith("/") ? parsed.path : joinPosix(root, parsed.path);

    const stat = yield* execution.fileSystem
      .stat(absoluteRemote)
      .pipe(
        Effect.mapError((cause) =>
          toOpenError(`无法访问远程路径：${formatSshUserMessage(cause)}`, cause),
        ),
      );

    if (stat.isDirectory) {
      return yield* toOpenError(
        "远程目录无法在本地编辑器中打开；请使用 IDE 的 Remote SSH 连接。若要编辑单个文件，请从文件链接打开。",
      );
    }

    const content = yield* execution.fileSystem
      .readFileString(absoluteRemote)
      .pipe(
        Effect.mapError((cause) =>
          toOpenError(`读取远程文件失败：${formatSshUserMessage(cause)}`, cause),
        ),
      );

    const rel = relativePosixPathWithinRoot(root, absoluteRemote) ?? basenamePosix(absoluteRemote);
    const safeRel = sanitizeTempRelativePath(rel);
    const localFile = join(remoteOpenTempDir(execution), ...safeRel.split("/"));

    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(localFile), { recursive: true });
        await writeFile(localFile, content, "utf8");
      },
      catch: (cause) => toOpenError("写入本地临时文件失败", cause),
    });

    return formatOpenEditorTarget({
      path: localFile,
      line: parsed.line,
      column: parsed.column,
    });
  });
