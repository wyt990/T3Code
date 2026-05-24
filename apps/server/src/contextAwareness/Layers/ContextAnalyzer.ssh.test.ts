import { ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceExecutionResolver,
  type WorkspaceExecution,
} from "../../workspace/Services/WorkspaceExecution.ts";
import { ContextAnalyzer } from "../Services/ContextAnalyzer.ts";
import { ContextAnalyzerLive } from "./ContextAnalyzer.ts";

const remoteRoot = "/home/user/repo";

const makeRemoteExecution = (): WorkspaceExecution => ({
  kind: "ssh",
  workspaceRoot: remoteRoot,
  sshConnectionId: "conn-ctx",
  spawnInteractive: () => Effect.die("unused"),
  exec: (input) => {
    if (input.command.includes("status --porcelain")) {
      return Effect.succeed({
        stdout: " M src/index.ts\n",
        stderr: "",
        exitCode: 0,
      });
    }
    if (input.command.includes("rev-parse")) {
      return Effect.succeed({ stdout: "", stderr: "", exitCode: 1 });
    }
    return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 });
  },
  fileSystem: {
    list: (targetPath) =>
      Effect.succeed(
        targetPath === remoteRoot
          ? [
              { name: "apps", path: `${remoteRoot}/apps`, type: "directory" as const },
              { name: "src", path: `${remoteRoot}/src`, type: "directory" as const },
            ]
          : targetPath === `${remoteRoot}/apps`
            ? [
                {
                  name: "web",
                  path: `${remoteRoot}/apps/web`,
                  type: "directory" as const,
                },
              ]
            : targetPath === `${remoteRoot}/apps/web`
              ? [
                  {
                    name: "entry.ts",
                    path: `${remoteRoot}/apps/web/entry.ts`,
                    type: "file" as const,
                  },
                ]
              : targetPath === `${remoteRoot}/src`
                ? [
                    {
                      name: "todo.ts",
                      path: `${remoteRoot}/src/todo.ts`,
                      type: "file" as const,
                    },
                  ]
                : [],
      ),
    stat: (targetPath) => {
      const isDirectory =
        targetPath === remoteRoot ||
        targetPath.endsWith("/apps") ||
        targetPath.endsWith("/src") ||
        targetPath.endsWith("/web") ||
        targetPath.endsWith("/.git");
      return Effect.succeed({
        path: targetPath,
        isDirectory,
        size: isDirectory ? 0 : 128,
      });
    },
    readFileBytes: () => Effect.die("unused"),
    readFileString: (targetPath) => {
      if (targetPath === `${remoteRoot}/apps/web/package.json`) {
        return Effect.succeed(JSON.stringify({ name: "@remote/web", private: true }));
      }
      if (targetPath === `${remoteRoot}/apps/web/entry.ts`) {
        return Effect.succeed('import { x } from "./local";\n');
      }
      if (targetPath === `${remoteRoot}/src/todo.ts`) {
        return Effect.succeed("// TODO: fix remote\n");
      }
      return Effect.die(`unexpected read: ${targetPath}`);
    },
    writeFileString: () => Effect.die("unused"),
    makeDirectory: () => Effect.die("unused"),
    unlink: () => Effect.die("unused"),
    rmdir: () => Effect.die("unused"),
    rename: () => Effect.die("unused"),
  },
  terminal: {
    open: () => Effect.die("unused"),
  },
});

const mockProjectionSnapshotQuery: ProjectionSnapshotQueryShape = {
  getSnapshot: () => Effect.die("unused"),
  getShellSnapshot: () => Effect.die("unused"),
  getCounts: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: (cwd) =>
    Effect.succeed(
      cwd === remoteRoot
        ? Option.some({
            id: ProjectId.make("project-ssh-ctx"),
            title: "Remote",
            workspaceRoot: remoteRoot,
            transport: { type: "ssh", sshConnectionId: "conn-ctx" },
            repositoryIdentity: null,
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            deletedAt: null,
          })
        : Option.none(),
    ),
  getProjectShellById: () => Effect.succeed(Option.none()),
  getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
  getThreadCheckpointContext: () => Effect.succeed(Option.none()),
  getThreadShellById: () => Effect.succeed(Option.none()),
  getThreadDetailById: () => Effect.succeed(Option.none()),
};

const SshContextAnalyzerLayer = Layer.empty.pipe(
  Layer.provideMerge(ContextAnalyzerLive),
  Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, mockProjectionSnapshotQuery)),
  Layer.provideMerge(
    Layer.succeed(WorkspaceExecutionResolver, {
      resolveByProjectId: () => Effect.succeed(makeRemoteExecution()),
    }),
  ),
);

it.layer(SshContextAnalyzerLayer)("ContextAnalyzer SSH", (it) => {
  it.effect("analyzeContext reads remote git status and TODO via SFTP", () =>
    Effect.gen(function* () {
      const analyzer = yield* ContextAnalyzer;
      const result = yield* analyzer.analyzeContext({
        projectId: ProjectId.make("project-ssh-ctx"),
        workspaceRoot: remoteRoot,
        options: {
          includeCoreModules: true,
          includeGitDiff: true,
          includeTodoComments: true,
          includeBranchDelta: false,
          maxEntries: 500,
          maxDependencyScanFiles: 40,
        },
      });

      const gitPaths = result.contextPool.entries
        .filter((e) => e.source.type === "git-diff")
        .map((e) => e.source.path);
      assert.include(gitPaths, "src/index.ts");

      const todoPaths = result.contextPool.entries
        .filter((e) => e.source.type === "todo-comment")
        .map((e) => e.source.path);
      assert.include(todoPaths, "src/todo.ts");

      assert.isDefined(result.dependencyGraph);
      assert.isTrue((result.dependencyGraph?.nodes.length ?? 0) >= 1);
    }),
  );
});
