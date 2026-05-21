import path from "node:path";
import posixPath from "node:path/posix";

import { shellQuotePosix } from "../ssh/ssh2Adapter.ts";

/** Join git-relative paths without applying the host OS path rules (for SSH / Unix remotes). */
export const joinGitPath = (cwd: string, segment: string, usePosixPaths: boolean): string => {
  if (usePosixPaths) {
    return posixPath.isAbsolute(segment) ? segment : posixPath.join(cwd, segment);
  }
  return path.isAbsolute(segment) ? segment : path.resolve(cwd, segment);
};

export const gitPathBasename = (targetPath: string, usePosixPaths: boolean): string =>
  usePosixPaths ? posixPath.basename(targetPath) : path.basename(targetPath);

export const gitPathDirname = (targetPath: string, usePosixPaths: boolean): string =>
  usePosixPaths ? posixPath.dirname(targetPath) : path.dirname(targetPath);

export const buildGitShellCommand = (args: ReadonlyArray<string>): string =>
  ["git", ...args].map(shellQuotePosix).join(" ");
