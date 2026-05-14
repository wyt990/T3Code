import * as FS from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";

import {
  clearTsconfigPathsCacheForTests,
  loadNearestTsconfigPaths,
  resolveTsconfigPathsImport,
} from "./tsconfigPathsResolve.ts";

describe("tsconfigPathsResolve", () => {
  afterEach(() => {
    clearTsconfigPathsCacheForTests();
  });

  it("resolves paths alias with single star", async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-tsconfig-paths-"));
    try {
      await FS.mkdir(join(root, "packages", "lib", "src"), { recursive: true });
      await FS.writeFile(
        join(root, "packages", "lib", "src", "util.ts"),
        "export const u = 1;\n",
        "utf-8",
      );

      await FS.mkdir(join(root, "apps", "app", "src"), { recursive: true });
      await FS.writeFile(
        join(root, "apps", "app", "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@lib/*": ["../../packages/lib/src/*"],
            },
          },
        }),
        "utf-8",
      );

      const sourceAbs = join(root, "apps", "app", "src", "main.ts");
      await FS.writeFile(sourceAbs, 'import { u } from "@lib/util";\n', "utf-8");

      const cache = new Map<string, boolean>();
      const hit = await resolveTsconfigPathsImport("@lib/util", sourceAbs, root, cache);
      expect(hit).toBe("packages/lib/src/util.ts");

      const ctx = await loadNearestTsconfigPaths(sourceAbs, root);
      expect(ctx?.pathMappings.some((m) => m.pattern === "@lib/*")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
