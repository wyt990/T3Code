import { Context, Effect, Stream } from "effect";
import type {
  InstallMethodSchema,
  InstallMethodId,
  ProviderInstallProgressEvent,
  ProviderKind,
} from "@t3tools/contracts";

export interface ProviderInstallerShape {
  /**
   * Get available installation methods for the current platform.
   */
  readonly getAvailableMethods: Effect.Effect<ReadonlyArray<InstallMethodSchema>>;

  /**
   * Install a provider with automatic fallback.
   * Returns a stream of progress events.
   */
  readonly install: (
    provider: ProviderKind,
    options?: { preferredMethod?: InstallMethodId },
  ) => Stream.Stream<ProviderInstallProgressEvent>;
}

export class ProviderInstaller extends Context.Service<ProviderInstaller, ProviderInstallerShape>()(
  "t3/provider/Services/ProviderInstaller",
) {}
