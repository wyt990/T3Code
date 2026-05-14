import * as FS from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  buildSpecifierResolutionMap,
  extractApproximateCallEdges,
  extractImportBindingTargets,
  extractResolvedImportLikeTargets,
} from "./dependencyGraphResolve.ts";
import { loadWorkspacePackageIndex } from "./workspacePackageResolve.ts";

describe("dependencyGraphResolve", () => {
  it("resolves relative import and paths alias in fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-dep-graph-"));
    try {
      await FS.mkdir(join(root, "packages", "lib", "src"), { recursive: true });
      await FS.writeFile(
        join(root, "packages", "lib", "src", "fn.ts"),
        "export function greet() { return 1; }\n",
        "utf-8",
      );

      await FS.mkdir(join(root, "apps", "app", "src"), { recursive: true });
      await FS.writeFile(
        join(root, "apps", "app", "package.json"),
        JSON.stringify({ name: "@fixture/app", private: true }),
        "utf-8",
      );
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

      const entryAbs = join(root, "apps", "app", "src", "entry.ts");
      const text = `
import { greet } from "@lib/fn";
import { x } from "./local";
const y = greet();
`;
      await FS.writeFile(
        join(root, "apps", "app", "src", "local.ts"),
        "export const x = 1;\n",
        "utf-8",
      );
      await FS.writeFile(entryAbs, text, "utf-8");

      const index = await loadWorkspacePackageIndex(root);
      const cache = new Map<string, boolean>();
      const { rels, externalIds } = await extractResolvedImportLikeTargets(
        entryAbs,
        root,
        text,
        index,
        cache,
      );
      expect(rels).toContain("packages/lib/src/fn.ts");
      expect(rels).toContain("apps/app/src/local.ts");
      expect(externalIds.length).toBe(0);

      const map = await buildSpecifierResolutionMap(entryAbs, root, text, index, cache);
      const bindings = extractImportBindingTargets(text, map);
      expect(bindings.get("greet")).toBe("packages/lib/src/fn.ts");

      const calls = extractApproximateCallEdges("apps/app/src/entry.ts", text, bindings);
      expect(
        calls.some((e) => e.to === "packages/lib/src/fn.ts" && e.from === "apps/app/src/entry.ts"),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
