import * as FS from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  loadWorkspacePackageIndex,
  parseBareModuleSpecifier,
  resolveBareSpecifierToWorkspaceRel,
} from "./workspacePackageResolve.ts";

describe("parseBareModuleSpecifier", () => {
  it("parses scoped package with subpath", () => {
    expect(parseBareModuleSpecifier("@scope/pkg/foo/bar")).toEqual({
      name: "@scope/pkg",
      subpath: "foo/bar",
    });
  });

  it("parses unscoped package", () => {
    expect(parseBareModuleSpecifier("react")).toEqual({ name: "react", subpath: "" });
    expect(parseBareModuleSpecifier("lodash/merge")).toEqual({ name: "lodash", subpath: "merge" });
  });

  it("rejects relative", () => {
    expect(parseBareModuleSpecifier("./x")).toBeNull();
    expect(parseBareModuleSpecifier("../x")).toBeNull();
  });
});

describe("loadWorkspacePackageIndex + resolveBareSpecifierToWorkspaceRel", () => {
  it("resolves workspace package via exports and types fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "t3-ws-pkg-"));
    try {
      await FS.mkdir(join(root, "packages", "lib-a", "src"), { recursive: true });
      await FS.writeFile(
        join(root, "packages", "lib-a", "package.json"),
        JSON.stringify({
          name: "@fixture/lib-a",
          exports: {
            ".": { types: "./src/entry.ts", import: "./src/entry.ts" },
            "./sub": { types: "./src/submod.ts", import: "./src/submod.ts" },
          },
        }),
        "utf-8",
      );
      await FS.writeFile(
        join(root, "packages", "lib-a", "src", "entry.ts"),
        "export const x = 1;\n",
        "utf-8",
      );
      await FS.writeFile(
        join(root, "packages", "lib-a", "src", "submod.ts"),
        "export const y = 2;\n",
        "utf-8",
      );

      await FS.mkdir(join(root, "apps", "app-b", "src"), { recursive: true });
      await FS.writeFile(
        join(root, "apps", "app-b", "package.json"),
        JSON.stringify({ name: "@fixture/app-b", private: true }),
        "utf-8",
      );

      const index = await loadWorkspacePackageIndex(root);
      const cache = new Map<string, boolean>();

      expect(index.has("@fixture/lib-a")).toBe(true);

      const entry = await resolveBareSpecifierToWorkspaceRel("@fixture/lib-a", root, index, cache);
      expect(entry).toBe("packages/lib-a/src/entry.ts");

      const sub = await resolveBareSpecifierToWorkspaceRel(
        "@fixture/lib-a/sub",
        root,
        index,
        cache,
      );
      expect(sub).toBe("packages/lib-a/src/submod.ts");

      const ext = await resolveBareSpecifierToWorkspaceRel("react", root, index, cache);
      expect(ext).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
