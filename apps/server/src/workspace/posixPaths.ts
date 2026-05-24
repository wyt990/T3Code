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
  const root = input.workspaceRoot.trim().replace(/\/+$/, "") || "/";

  // 支持地址栏输入的绝对 POSIX 路径（如 /apps/project 或 /apps/project/src）
  if (isPosixAbsolutePath(normalizedInputPath)) {
    if (normalizedInputPath === root || normalizedInputPath === root + "/") {
      // 绝对路径等于 workspaceRoot → 相当于浏览根目录
      return { absolutePath: root || "/", relativePath: "." };
    }
    const prefix = root + "/";
    if (normalizedInputPath.startsWith(prefix)) {
      // 绝对路径在 workspaceRoot 内 → 提取相对部分
      const relativePath = normalizedInputPath.slice(prefix.length);
      return { absolutePath: normalizedInputPath, relativePath };
    }
    return { outsideRoot: true };
  }

  const segments = normalizedInputPath.split("/").filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === "..") {
      return { outsideRoot: true };
    }
  }

  const absolutePath = segments.length === 0 ? root : joinPosix(root, ...segments);
  const relativePath = segments.join("/");

  if (relativePosixPathWithinRoot(root, absolutePath) === null) {
    return { outsideRoot: true };
  }

  return { absolutePath, relativePath };
};
