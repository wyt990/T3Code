import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "~/lib/utils";

const TooltipCreateHandle = TooltipPrimitive.createHandle;

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipPopup({
  className,
  align = "center",
  sideOffset = 4,
  side = "top",
  anchor,
  copyAction,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & {
  align?: TooltipPrimitive.Positioner.Props["align"];
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  anchor?: TooltipPrimitive.Positioner.Props["anchor"];
  /** Renders a copy control; placement follows resolved `data-side` on the positioner. */
  copyAction?: ReactNode;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        anchor={anchor}
        className={cn(
          "z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none",
          copyAction &&
            "[&[data-side=bottom]_[data-slot=tooltip-copy-action]]:top-1.5 [&[data-side=bottom]_[data-slot=tooltip-copy-action]]:right-1.5 [&[data-side=top]_[data-slot=tooltip-copy-action]]:bottom-1.5 [&[data-side=top]_[data-slot=tooltip-copy-action]]:right-1.5 [&[data-side=left]_[data-slot=tooltip-copy-action]]:top-1.5 [&[data-side=left]_[data-slot=tooltip-copy-action]]:right-1.5 [&[data-side=right]_[data-slot=tooltip-copy-action]]:top-1.5 [&[data-side=right]_[data-slot=tooltip-copy-action]]:right-1.5 [&[data-side=bottom]_[data-slot=tooltip-copy-body]]:pt-8 [&[data-side=top]_[data-slot=tooltip-copy-body]]:pb-8",
        )}
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) text-balance rounded-md border bg-popover not-dark:bg-clip-padding text-popover-foreground text-xs shadow-md/5 transition-[width,height,scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          data-slot="tooltip-popup"
          {...props}
        >
          <TooltipPrimitive.Viewport
            className={cn(
              "relative size-full px-(--viewport-inline-padding) py-1 [--viewport-inline-padding:--spacing(2)] data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:truncate **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity",
              copyAction ? "overflow-visible" : "overflow-clip",
            )}
            data-slot="tooltip-viewport"
          >
            {copyAction ? (
              <div className="relative">
                <div className="absolute z-10" data-slot="tooltip-copy-action">
                  {copyAction}
                </div>
                <div
                  className="max-h-[min(50vh,28rem)] overflow-auto pr-9 [--viewport-inline-padding:0]"
                  data-slot="tooltip-copy-body"
                >
                  {children}
                </div>
              </div>
            ) : (
              children
            )}
          </TooltipPrimitive.Viewport>
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { TooltipCreateHandle, TooltipProvider, Tooltip, TooltipTrigger, TooltipPopup };
