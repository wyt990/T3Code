import { assert, it } from "@effect/vitest";

import {
  SSH_EXEC_TIMEOUT_MS,
  SSH_KEEPALIVE_COUNT_MAX,
  SSH_KEEPALIVE_INTERVAL_MS,
  SSH_READY_TIMEOUT_MS,
  defaultSshConnectConfigFields,
} from "./sshConnectDefaults.ts";

it("defaultSshConnectConfigFields matches step 13 keepalive guidance", () => {
  const fields = defaultSshConnectConfigFields();
  assert.strictEqual(fields.readyTimeout, SSH_READY_TIMEOUT_MS);
  assert.strictEqual(fields.keepaliveInterval, SSH_KEEPALIVE_INTERVAL_MS);
  assert.strictEqual(fields.keepaliveCountMax, SSH_KEEPALIVE_COUNT_MAX);
  assert.strictEqual(SSH_KEEPALIVE_INTERVAL_MS, 30_000);
  assert.strictEqual(SSH_EXEC_TIMEOUT_MS > 0, true);
});
