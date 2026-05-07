import { Effect, FileSystem, Path, Predicate } from "effect";
import * as Random from "effect/Random";

const isWin32Platform = (): boolean =>
  typeof process !== "undefined" &&
  typeof process.platform === "string" &&
  process.platform === "win32";

/**
 * Windows often returns EPERM on rename(tmp → existingTarget) when the target is
 * briefly locked (Defender, indexer, another reader). Same-directory atomic replace
 * via rename is ideal; copyFile overwrite + remove temp is a pragmatic fallback.
 */
const isFileSystemRenamePlatformError = (error: unknown): boolean => {
  if (!Predicate.isTagged(error, "PlatformError")) {
    return false;
  }
  const reason = (
    error as { readonly reason?: { readonly module?: string; readonly method?: string } }
  ).reason;
  return reason?.module === "FileSystem" && reason?.method === "rename";
};

const commitTempToFinalPath = (fs: FileSystem.FileSystem, tempPath: string, finalPath: string) =>
  fs.rename(tempPath, finalPath).pipe(
    Effect.catchIf(
      (error) => isWin32Platform() && isFileSystemRenamePlatformError(error),
      () =>
        Effect.gen(function* () {
          yield* fs.copyFile(tempPath, finalPath);
          yield* fs.remove(tempPath);
        }),
    ),
  );

export const writeFileStringAtomically = (input: {
  readonly filePath: string;
  readonly contents: string;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempFileId = yield* Random.nextUUIDv4;
      const targetDirectory = path.dirname(input.filePath);

      yield* fs.makeDirectory(targetDirectory, { recursive: true });
      const tempDirectory = yield* fs.makeTempDirectoryScoped({
        directory: targetDirectory,
        prefix: `${path.basename(input.filePath)}.`,
      });
      const tempPath = path.join(tempDirectory, `${tempFileId}.tmp`);

      yield* fs.writeFileString(tempPath, input.contents);
      yield* commitTempToFinalPath(fs, tempPath, input.filePath);
    }),
  );
