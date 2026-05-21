import fs from "node:fs";
import path from "node:path";

const filePath = path.join(import.meta.dirname, "..", "src", "server.ts");
let source = fs.readFileSync(filePath, "utf8");

source = source.replace(
  `import { RepositoryIdentityResolverLive } from "./project/Layers/RepositoryIdentityResolver.ts";
import { WorkspaceEntriesLive } from "./workspace/Layers/WorkspaceEntries.ts";`,
  `import { RepositoryIdentityResolverLive } from "./project/Layers/RepositoryIdentityResolver.ts";
import { RemoteProviderProbeLive } from "./provider/remoteProviderProbe.ts";
import { SshInfrastructureLive } from "./ssh/Layers/index.ts";
import { WorkspaceEntriesLive } from "./workspace/Layers/WorkspaceEntries.ts";
import { WorkspaceExecutionResolverLive } from "./workspace/Layers/WorkspaceExecutionResolver.ts";`,
);

source = source.replace(
  `const ProviderRuntimeLayerLive = ProviderSessionReaperLive.pipe(
  Layer.provideMerge(ProviderLayerLive),
  Layer.provideMerge(OrchestrationLayerLive),
);`,
  `const ProviderRuntimeLayerLive = ProviderSessionReaperLive.pipe(
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(ProviderLayerLive),
);`,
);

source = source.replace(
  `    Layer.provideMerge(PersistenceLayerLive),
    Layer.provideMerge(KeybindingsLive),`,
  `    Layer.provideMerge(PersistenceLayerLive),
    Layer.provideMerge(SshInfrastructureLive),
    Layer.provideMerge(WorkspaceExecutionResolverLive),
    Layer.provideMerge(KeybindingsLive),`,
);

source = source.replace(
  `    Layer.provideMerge(ProviderInstallerLive),
    Layer.provideMerge(WorkspaceLayerLive),`,
  `    Layer.provideMerge(ProviderInstallerLive),
    Layer.provideMerge(RemoteProviderProbeLive),
    Layer.provideMerge(WorkspaceLayerLive),`,
);

fs.writeFileSync(filePath, source, "utf8");
console.log("patched", filePath);
