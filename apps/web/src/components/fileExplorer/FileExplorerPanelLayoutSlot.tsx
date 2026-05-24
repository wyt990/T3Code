import { useWorkbenchContextBinding } from "../../contextAwareness/useWorkbenchContextBinding";
import { FileExplorerPanel } from "./FileExplorerPanel";
import { cn } from "~/lib/utils";
import type { EnvironmentId } from "@t3tools/contracts";

export function FileExplorerPanelLayoutSlot({ className }: { className?: string }) {
  const { projectId, workspaceRoot, session } = useWorkbenchContextBinding();

  if (!projectId || !workspaceRoot || !session) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full text-muted-foreground text-sm",
          className,
        )}
      >
        请先选择一个项目
      </div>
    );
  }

  return (
    <FileExplorerPanel
      environmentId={session.environmentId as EnvironmentId}
      workspaceRoot={workspaceRoot}
      sessionKey={`${session.environmentId}:${session.threadId}`}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
