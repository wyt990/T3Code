import { assert, it } from "@effect/vitest";

import { SshConnectionError } from "./Errors.ts";
import { formatSshUserMessage } from "./formatSshUserMessage.ts";

it("formatSshUserMessage maps common connection failures", () => {
  assert.strictEqual(
    formatSshUserMessage(new SshConnectionError({ connectionId: "c1", detail: "Timed out" })),
    "SSH 连接超时，请检查主机地址、端口与网络。",
  );
  assert.strictEqual(
    formatSshUserMessage(new Error("connect ECONNREFUSED 127.0.0.1:22")),
    "无法连接到 SSH 主机，请确认主机名、端口与防火墙设置。",
  );
  assert.strictEqual(
    formatSshUserMessage(new Error("All configured authentication methods failed")),
    "SSH 认证失败，请检查用户名、密码、私钥或 ssh-agent。",
  );
});
