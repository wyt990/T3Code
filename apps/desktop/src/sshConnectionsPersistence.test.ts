import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  deleteSshConnection,
  listSshConnections,
  upsertSshConnection,
} from "./sshConnectionsPersistence.ts";

describe("sshConnectionsPersistence", () => {
  it("upserts and deletes connections", () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "t3-ssh-connections-test-"));
    const filePath = Path.join(directory, "ssh-connections.json");

    const created = upsertSshConnection(filePath, {
      host: "example.com",
      username: "user",
      authType: "password",
      label: "Example",
    });
    expect(created.host).toBe("example.com");
    expect(listSshConnections(filePath)).toHaveLength(1);

    const updated = upsertSshConnection(filePath, {
      id: created.id,
      host: "example.com",
      username: "user",
      authType: "password",
      label: "Example Updated",
    });
    expect(updated.label).toBe("Example Updated");
    expect(listSshConnections(filePath)).toHaveLength(1);

    deleteSshConnection(filePath, created.id);
    expect(listSshConnections(filePath)).toHaveLength(0);
  });
});
