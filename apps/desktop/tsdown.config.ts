import { defineConfig } from "tsdown";

const isProduction = process.env.NODE_ENV === "production" || process.env.BUILD_TARGET === "production";

const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: !isProduction,
  outExtensions: () => ({ js: ".cjs" }),
};

// 所有 workspace 包和 effect 相关包都必须内联，因为它们是 private 的，无法在 staging 目录解析
const isWorkspacePackage = (id: string) =>
  id.startsWith("@t3tools/") ||
  id.startsWith("effect-acp") ||
  id.startsWith("effect-codex-app-server");

export default defineConfig([
  {
    ...shared,
    entry: ["src/main.ts"],
    clean: true,
    noExternal: isWorkspacePackage,
    // 优化：启用更激进的 tree-shaking
    treeshake: true,
    // 优化：使用更快的压缩级别（生产构建时）
    minify: isProduction ? "dce-only" : false,
  },
  {
    ...shared,
    entry: ["src/preload.ts"],
    noExternal: isWorkspacePackage,
  },
]);
