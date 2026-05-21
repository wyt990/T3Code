import { Effect, FileSystem, Layer, Schema, SynchronizedRef } from "effect";

import { ServerConfig } from "../../config.ts";
import { SshHostKeyUnknownError, SshHostKeyUntrustedError } from "../Errors.ts";
import { sshHostKeyFingerprintSha256 } from "../ssh2Adapter.ts";
import { SshHostKeyVerifier } from "../Services/SshHostKeyVerifier.ts";

const KnownHostsFile = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      host: Schema.String,
      port: Schema.Number,
      fingerprint: Schema.String,
    }),
  ),
});

const hostKey = (host: string, port: number) => `${host}:${port}`;

export const makeSshHostKeyVerifier = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig;
  const filePath = `${config.stateDir}/ssh-known-hosts.json`;
  const entriesRef = yield* SynchronizedRef.make(
    new Map<
      string,
      { readonly host: string; readonly port: number; readonly fingerprint: string }
    >(),
  );
  let entriesSnapshot = new Map<
    string,
    { readonly host: string; readonly port: number; readonly fingerprint: string }
  >();

  const syncSnapshot = (
    entries: Map<string, { host: string; port: number; fingerprint: string }>,
  ) => {
    entriesSnapshot = entries;
  };

  const load = Effect.fn("SshHostKeyVerifier.load")(function* () {
    const exists = yield* fileSystem.exists(filePath);
    if (!exists) {
      return;
    }
    const contents = yield* fileSystem.readFileString(filePath).pipe(Effect.orDie);
    if (contents.trim().length === 0) {
      return;
    }
    const decoded = yield* Schema.decodeUnknownEffect(KnownHostsFile)(JSON.parse(contents)).pipe(
      Effect.orDie,
    );
    const next = new Map<string, { host: string; port: number; fingerprint: string }>();
    for (const entry of decoded.entries) {
      next.set(hostKey(entry.host, entry.port), entry);
    }
    yield* SynchronizedRef.set(entriesRef, next);
    syncSnapshot(next);
  });

  yield* load();

  const persist = Effect.fn("SshHostKeyVerifier.persist")(function* () {
    const entries = yield* SynchronizedRef.get(entriesRef);
    const payload = {
      entries: [...entries.values()],
    };
    yield* fileSystem
      .writeFileString(filePath, `${JSON.stringify(payload, null, 2)}\n`)
      .pipe(Effect.orDie);
  });

  const fingerprintForHost: (typeof SshHostKeyVerifier)["Service"]["fingerprintForHost"] = (
    input,
  ) => entriesSnapshot.get(hostKey(input.host, input.port))?.fingerprint;

  const verifyHostKey: (typeof SshHostKeyVerifier)["Service"]["verifyHostKey"] = Effect.fn(
    "SshHostKeyVerifier.verifyHostKey",
  )(function* (input) {
    const fingerprint = sshHostKeyFingerprintSha256(input.hostKey);
    const entries = yield* SynchronizedRef.get(entriesRef);
    const existing = entries.get(hostKey(input.host, input.port));
    if (existing === undefined) {
      return yield* new SshHostKeyUnknownError({
        host: input.host,
        port: input.port,
        fingerprint,
      });
    }
    if (existing.fingerprint !== fingerprint) {
      return yield* new SshHostKeyUntrustedError({
        host: input.host,
        port: input.port,
        fingerprint,
        expectedFingerprint: existing.fingerprint,
      });
    }
  });

  const recordTrustedHost: (typeof SshHostKeyVerifier)["Service"]["recordTrustedHost"] = Effect.fn(
    "SshHostKeyVerifier.recordTrustedHost",
  )(function* (input) {
    yield* SynchronizedRef.update(entriesRef, (entries) => {
      const next = new Map(entries);
      next.set(hostKey(input.host, input.port), input);
      syncSnapshot(next);
      return next;
    });
    yield* persist();
  });

  return {
    fingerprintForHost,
    verifyHostKey,
    recordTrustedHost,
  } satisfies (typeof SshHostKeyVerifier)["Service"];
});

export const SshHostKeyVerifierLive = Layer.effect(SshHostKeyVerifier, makeSshHostKeyVerifier);

export const makeSshHostKeyVerifierTrustAllTestLayer = () =>
  Layer.succeed(SshHostKeyVerifier, {
    fingerprintForHost: () => "SHA256:test",
    verifyHostKey: () => Effect.void,
    recordTrustedHost: () => Effect.void,
  });
