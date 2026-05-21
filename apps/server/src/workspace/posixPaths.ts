export const isPosixAbsolutePath = (input: string): boolean => input.startsWith("/");

export const joinPosix = (...segments: ReadonlyArray<string>): string => {
  const absolute = segments.some((segment) => segment.startsWith("/"));
  const parts = segments
    .flatMap((segment) => segment.split("/"))
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (parts.length === 0) {
    return absolute ? "/" : ".";
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined;
};

export const dirnamePosix = (input: string): string => {
  const normalized = input.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return normalized.startsWith("/") ? "/" : ".";
  }
  return normalized.slice(0, index);
};

export const basenamePosix = (input: string): string => {
  const normalized = input.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
};

export const relativePosixPathWithinRoot = (
  workspaceRoot: string,
  absolutePath: string,
): string | null => {
  const root = workspaceRoot.replace(/\/+$/, "") || "/";
  const absolute = absolutePath.replace(/\/+$/, "") || "/";
  if (absolute === root) {
    return "";
  }
  const prefix = `${root}/`;
  if (!absolute.startsWith(prefix)) {
    return null;
  }
  return absolute.slice(prefix.length);
};

export const resolveRelativePathWithinPosixRoot = (input: {
  readonly workspaceRoot: string;
  readonly relativePath: string;
}):
  | { readonly absolutePath: string; readonly relativePath: string }
  | { readonly outsideRoot: true } => {
  const normalizedInputPath = input.relativePath.trim().replaceAll("\\", "/");
  if (isPosixAbsolutePath(normalizedInputPath)) {
    return { outsideRoot: true };
  }

  const segments = normalizedInputPath.split("/").filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === "..") {
      return { outsideRoot: true };
    }
  }

  const root = input.workspaceRoot.trim().replace(/\/+$/, "") || "/";
  const absolutePath = segments.length === 0 ? root : joinPosix(root, ...segments);
  const relativePath = segments.join("/");

  if (relativePosixPathWithinRoot(root, absolutePath) === null) {
    return { outsideRoot: true };
  }

  return { absolutePath, relativePath };
};
