/** POSIX path helpers for SSH remote directory browse in the command palette. */

export const SSH_BROWSE_INITIAL_PATH = "/";

export function normalizeSshBrowsePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return SSH_BROWSE_INITIAL_PATH;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function hasTrailingSshPathSeparator(path: string): boolean {
  return path === "/" || path.endsWith("/");
}

export function getSshBrowseDirectoryPath(currentPath: string): string {
  const normalized = normalizeSshBrowsePath(currentPath);
  if (hasTrailingSshPathSeparator(normalized)) {
    return normalized;
  }

  const lastSeparatorIndex = normalized.lastIndexOf("/");
  if (lastSeparatorIndex <= 0) {
    return SSH_BROWSE_INITIAL_PATH;
  }

  return normalized.slice(0, lastSeparatorIndex + 1);
}

export function getSshBrowseLeafPathSegment(currentPath: string): string {
  const normalized = normalizeSshBrowsePath(currentPath);
  if (normalized === SSH_BROWSE_INITIAL_PATH) {
    return "";
  }

  const directoryPath = getSshBrowseDirectoryPath(normalized);
  if (directoryPath === SSH_BROWSE_INITIAL_PATH) {
    return normalized.slice(1);
  }

  return normalized.slice(directoryPath.length);
}

export function appendSshBrowsePathSegment(currentPath: string, segment: string): string {
  const directoryPath = getSshBrowseDirectoryPath(currentPath);
  if (directoryPath === SSH_BROWSE_INITIAL_PATH) {
    return `/${segment}/`;
  }

  return `${directoryPath}${segment}/`;
}

export function getSshBrowseParentPath(currentPath: string): string | null {
  const normalized = normalizeSshBrowsePath(currentPath).replace(/\/+$/, "");
  if (normalized.length === 0 || normalized === SSH_BROWSE_INITIAL_PATH) {
    return null;
  }

  const lastSeparatorIndex = normalized.lastIndexOf("/");
  if (lastSeparatorIndex <= 0) {
    return SSH_BROWSE_INITIAL_PATH;
  }

  return `${normalized.slice(0, lastSeparatorIndex)}/`;
}

export function canNavigateSshUp(currentPath: string): boolean {
  return getSshBrowseParentPath(currentPath) !== null;
}

export function resolveSshProjectWorkspaceRoot(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    return "";
  }

  return hasTrailingSshPathSeparator(trimmed)
    ? trimmed.replace(/\/+$/, "") || SSH_BROWSE_INITIAL_PATH
    : trimmed;
}
