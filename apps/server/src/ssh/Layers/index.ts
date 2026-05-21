import { Layer } from "effect";

import { SshConnectionPoolLive } from "./SshConnectionPool.ts";
import { SshConnectionRegistryLive } from "./SshConnectionRegistry.ts";
import { SshCredentialResolverLive } from "./SshCredentialResolver.ts";
import { SshFileSystemLive } from "./SshFileSystem.ts";
import { SshHostKeyVerifierLive } from "./SshHostKeyVerifier.ts";
import { SshPortForwardLive } from "./SshPortForward.ts";
import { SshProcessRunnerLive } from "./SshProcessRunner.ts";

export { SshConnectionPoolLive } from "./SshConnectionPool.ts";
export { SshConnectionRegistryLive } from "./SshConnectionRegistry.ts";
export {
  SshCredentialResolverLive,
  makeSshCredentialResolverTestLayer,
} from "./SshCredentialResolver.ts";
export { SshFileSystemLive } from "./SshFileSystem.ts";
export {
  SshHostKeyVerifierLive,
  makeSshHostKeyVerifierTrustAllTestLayer,
} from "./SshHostKeyVerifier.ts";
export { SshProcessRunnerLive } from "./SshProcessRunner.ts";
export { SshPortForwardLive, makeSshPortForwardTestLayer } from "./SshPortForward.ts";
export { makeSshConnectionPoolTestLayer } from "./SshConnectionPool.ts";
export { makeSshConnectionRegistryTestLayer } from "./SshConnectionRegistry.ts";

const SshIdentityLive = Layer.mergeAll(SshConnectionRegistryLive, SshHostKeyVerifierLive);

export const SshInfrastructureLive = SshProcessRunnerLive.pipe(
  Layer.provideMerge(SshFileSystemLive),
  Layer.provideMerge(SshPortForwardLive),
  Layer.provideMerge(
    SshConnectionPoolLive.pipe(
      Layer.provideMerge(SshCredentialResolverLive.pipe(Layer.provideMerge(SshIdentityLive))),
      Layer.provideMerge(SshIdentityLive),
    ),
  ),
  Layer.provideMerge(SshIdentityLive),
);
