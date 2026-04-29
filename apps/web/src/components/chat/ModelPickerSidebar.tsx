import { type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { memo } from "react";
import { Clock3Icon, SparklesIcon, StarIcon } from "lucide-react";
import { AVAILABLE_PROVIDER_OPTIONS, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { getProviderSnapshot } from "../../providerModels";

function describeUnavailableProvider(label: string, live: ServerProvider | undefined): string {
  if (!live) {
    return `${label} - 等待提供商状态...`;
  }
  if (live.status === "ready") {
    return label;
  }
  const kind =
    live.status === "error"
      ? "不可用"
      : live.status === "warning"
        ? "受限"
        : live.status === "disabled"
          ? "已在设置中禁用"
          : "未就绪";
  const msg = live.message?.trim();
  return msg ? `${label} - ${kind}. ${msg}` : `${label} - ${kind}.`;
}

const SELECTED_BUTTON_CLASS = "bg-background text-foreground shadow-sm";
const SELECTED_INDICATOR_CLASS =
  "pointer-events-none absolute -right-1 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary";
const BADGE_BASE_CLASS =
  "pointer-events-none absolute -right-0.5 top-0.5 z-10 flex size-3.5 items-center justify-center rounded-full bg-transparent shadow-sm ";
const NEW_BADGE_CLASS = `${BADGE_BASE_CLASS} text-amber-600  dark:text-amber-300 `;
const SOON_BADGE_CLASS = `${BADGE_BASE_CLASS} text-muted-foreground `;

/** Opens toward the rail so the list stays readable (not over the model names). */
const PICKER_TOOLTIP_SIDE = "left" as const;
const PICKER_TOOLTIP_CLASS = "max-w-64 text-balance font-normal leading-snug";

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedProvider: ProviderKind | "favorites";
  onSelectProvider: (provider: ProviderKind | "favorites") => void;
  providers?: ReadonlyArray<ServerProvider>;
}) {
  const visibleProviderOptions = AVAILABLE_PROVIDER_OPTIONS.filter((option) => {
    if (!props.providers || props.providers.length === 0) {
      return true;
    }
    const liveProvider = getProviderSnapshot(props.providers, option.value);
    return liveProvider?.enabled === true;
  });

  const handleProviderClick = (provider: ProviderKind | "favorites") => {
    props.onSelectProvider(provider);
  };

  return (
    <div className="flex flex-col w-12 border-r bg-muted/30  p-1 overflow-y-auto gap-1">
      {/* Favorites section */}
      <div className="pb-1 mb-1 border-b">
        <div className="relative w-full">
          {props.selectedProvider === "favorites" && <div className={SELECTED_INDICATOR_CLASS} />}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={cn(
                    "relative isolate flex w-full cursor-pointer aspect-square items-center justify-center rounded transition-colors hover:bg-muted",
                    props.selectedProvider === "favorites" && SELECTED_BUTTON_CLASS,
                  )}
                  onClick={() => handleProviderClick("favorites")}
                  type="button"
                  data-model-picker-provider="favorites"
                  aria-label="收藏"
                >
                  <StarIcon className="size-5 fill-current shrink-0" aria-hidden />
                </button>
              }
            />
            <TooltipPopup
              side={PICKER_TOOLTIP_SIDE}
              align="center"
              className={PICKER_TOOLTIP_CLASS}
            >
              收藏
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>

      {/* Provider buttons */}
      {visibleProviderOptions.map((option) => {
        const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
        const liveProvider = props.providers
          ? getProviderSnapshot(props.providers, option.value)
          : undefined;

        const isDisabled = !liveProvider || liveProvider.status !== "ready";
        const isSelected = props.selectedProvider === option.value;
        const badge = option.pickerSidebarBadge;

        const providerTooltip = isDisabled
          ? describeUnavailableProvider(option.label, liveProvider)
          : badge === "new"
            ? `${option.label} - 新功能`
            : option.label;

        const button = (
          <button
            data-model-picker-provider={option.value}
            className={cn(
              "relative isolate flex w-full cursor-pointer aspect-square items-center justify-center rounded transition-colors hover:bg-muted",
              isSelected && SELECTED_BUTTON_CLASS,
              isDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
            )}
            onClick={() => !isDisabled && handleProviderClick(option.value)}
            disabled={isDisabled}
            type="button"
            aria-label={
              isDisabled
                ? (providerTooltip ?? option.label)
                : badge === "new"
                  ? `${option.label}, 新功能`
                  : option.label
            }
          >
            <OptionIcon className="size-5 shrink-0" aria-hidden />
            {badge === "new" ? (
              <span className={NEW_BADGE_CLASS} aria-hidden>
                <SparklesIcon className="size-2" />
              </span>
            ) : badge === "soon" ? (
              <span className={SOON_BADGE_CLASS} aria-hidden>
                <Clock3Icon className="size-2" />
              </span>
            ) : null}
          </button>
        );

        const trigger = isDisabled ? (
          <span className="relative block w-full">{button}</span>
        ) : (
          button
        );

        return (
          <div key={option.value} className="relative w-full">
            {isSelected && <div className={SELECTED_INDICATOR_CLASS} />}
            <Tooltip>
              <TooltipTrigger render={trigger} />
              <TooltipPopup
                side={PICKER_TOOLTIP_SIDE}
                align="center"
                className={PICKER_TOOLTIP_CLASS}
              >
                {providerTooltip}
              </TooltipPopup>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
});
