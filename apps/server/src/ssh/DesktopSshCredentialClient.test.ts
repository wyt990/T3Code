import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, describe, expect, vi } from "vitest";

import { fetchDesktopSshAuthMaterial } from "./DesktopSshCredentialClient.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchDesktopSshAuthMaterial", () => {
  it.effect("decodes password and passphrase from the desktop credential service", () =>
    Effect.gen(function* () {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          password: "secret-password",
          passphrase: "secret-passphrase",
        }),
      }) as unknown as typeof fetch;

      const material = yield* fetchDesktopSshAuthMaterial({
        port: 5733,
        bootstrapToken: "bootstrap-token",
        connectionId: "conn-1",
      });

      assert.deepEqual(material, {
        password: "secret-password",
        passphrase: "secret-passphrase",
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:5733/v1/ssh/credential",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer bootstrap-token",
          }),
        }),
      );
    }),
  );

  it.effect("maps HTTP failures to SshCredentialUnavailableError", () =>
    Effect.gen(function* () {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }) as unknown as typeof fetch;

      const result = yield* Effect.flip(
        fetchDesktopSshAuthMaterial({
          port: 5733,
          bootstrapToken: "bootstrap-token",
          connectionId: "conn-1",
        }),
      );

      assert.equal(result._tag, "SshCredentialUnavailableError");
    }),
  );
});
