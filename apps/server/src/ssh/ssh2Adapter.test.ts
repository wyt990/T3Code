import { assert, it } from "@effect/vitest";

import { buildRemoteCdPrefix, createSsh2Client, isSsh2ClientAlive } from "./ssh2Adapter.ts";

it("buildRemoteCdPrefix expands tilde for remote home", () => {
  assert.strictEqual(buildRemoteCdPrefix("~"), "cd ~ && ");
  assert.strictEqual(buildRemoteCdPrefix(undefined), "");
  assert.strictEqual(buildRemoteCdPrefix("/var/log"), "cd /var/log && ");
});

it("isSsh2ClientAlive reports destroyed clients as not alive", () => {
  const client = createSsh2Client();
  assert.strictEqual(isSsh2ClientAlive(client), true);
  (client as { destroyed?: boolean }).destroyed = true;
  assert.strictEqual(isSsh2ClientAlive(client), false);
});
