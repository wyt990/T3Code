import { cn } from "~/lib/utils";
import { isElectron } from "../../env";

export function chatViewHeaderShellClassName(reserveTitleBarControlInset: boolean): string {
  return cn(
    "border-b border-border px-3 sm:px-5",
    isElectron
      ? cn(
          "drag-region flex h-[52px] items-center wco:h-[env(titlebar-area-height)]",
          reserveTitleBarControlInset &&
            "wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]",
        )
      : "py-2 sm:py-3",
  );
}
