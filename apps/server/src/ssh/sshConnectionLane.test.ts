import { assert, it } from "@effect/vitest";

import {
  matchesConnectionId,
  parsePooledConnectionKey,
  pooledConnectionKeysForConnection,
  resolvePooledConnectionKey,
} from "./sshConnectionLane.ts";

it("resolvePooledConnectionKey namespaces lanes per connection id", () => {
  assert.equal(resolvePooledConnectionKey("conn-a", "git"), "conn-a::git");
  assert.equal(resolvePooledConnectionKey("conn-a", "probe"), "conn-a::probe");
  assert.equal(pooledConnectionKeysForConnection("conn-a").length, 5);
  assert.equal(resolvePooledConnectionKey("conn-a", "browse"), "conn-a::browse");
});

it("parsePooledConnectionKey recovers connection id and lane", () => {
  assert.deepEqual(parsePooledConnectionKey("conn-a::interactive"), {
    connectionId: "conn-a",
    lane: "interactive",
  });
});

it("matchesConnectionId matches legacy and lane keys", () => {
  assert.equal(matchesConnectionId("conn-a::git", "conn-a"), true);
  assert.equal(matchesConnectionId("conn-b::probe", "conn-a"), false);
});
