import { describe, expect, it } from "vitest";

import { parseGitObjectIdFromOutput } from "./Layers/CheckpointStore.ts";

describe("parseGitObjectIdFromOutput", () => {
  it("parses a single oid line", () => {
    expect(parseGitObjectIdFromOutput("f9789d3c8ecabe4cc2c1a4bd21afc0bb4319ae87\n")).toBe(
      "f9789d3c8ecabe4cc2c1a4bd21afc0bb4319ae87",
    );
  });

  it("uses the last oid when shell banners precede git output", () => {
    expect(
      parseGitObjectIdFromOutput("Welcome to Ubuntu\nf9789d3c8ecabe4cc2c1a4bd21afc0bb4319ae87\n"),
    ).toBe("f9789d3c8ecabe4cc2c1a4bd21afc0bb4319ae87");
  });

  it("returns null when no oid is present", () => {
    expect(parseGitObjectIdFromOutput("")).toBeNull();
    expect(parseGitObjectIdFromOutput("only banner text\n")).toBeNull();
  });
});
