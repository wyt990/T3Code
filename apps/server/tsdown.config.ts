import { defineConfig } from "tsdown";

const isProduction = process.env.NODE_ENV === "production";

// 所有 workspace 包和 effect 相关包都必须内联，因为它们是 private 的，无法在 staging 目录解析
const isWorkspacePackage = (id: string) =>
  id.startsWith("@t3tools/") ||
  id.startsWith("effect-acp") ||
  id.startsWith("effect-codex-app-server");

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: !isProduction,
  clean: true,
  noExternal: isWorkspacePackage,
  inlineOnly: false,
  // 优化：启用 tree-shaking 移除未使用代码
  treeshake: true,
  // 优化：生产构建时使用更快的压缩
  minify: isProduction ? "dce-only" : false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
