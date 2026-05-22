import { stackedThreadToast, toastManager } from "../ui/toast";

const TABS_AT_CAP_TOAST_TIMEOUT_MS = 8000;

export function showTabsAtCapToast(args: {
  suggestedReplacementTabId: string | null;
  onReplaceLru: () => void;
}): void {
  const { suggestedReplacementTabId, onReplaceLru } = args;
  toastManager.add(
    stackedThreadToast({
      type: "warning",
      title: "已达 6 个标签上限",
      description:
        suggestedReplacementTabId === null
          ? "请先关闭一个标签后再打开此会话。"
          : "替换最久未访问的标签以打开此会话？",
      timeout: TABS_AT_CAP_TOAST_TIMEOUT_MS,
      ...(suggestedReplacementTabId === null
        ? {}
        : {
            actionProps: {
              children: "替换最久未访问",
              onClick: onReplaceLru,
            },
          }),
    }),
  );
}

/** Shown when URL navigation (back/forward, deep link) must evict the active tab. */
export function showTabsAtCapReplaceActiveToast(onReplaceActive: () => void): void {
  toastManager.add(
    stackedThreadToast({
      type: "warning",
      title: "已达 6 个标签上限",
      description: "替换当前标签以打开此页面？",
      timeout: TABS_AT_CAP_TOAST_TIMEOUT_MS,
      actionProps: {
        children: "替换当前标签",
        onClick: onReplaceActive,
      },
    }),
  );
}

export function showTabsAtCapBlockedToast(): void {
  toastManager.add(
    stackedThreadToast({
      type: "warning",
      title: "已达 6 个标签上限",
      description: "请先关闭一个标签后再打开新标签。",
      timeout: TABS_AT_CAP_TOAST_TIMEOUT_MS,
    }),
  );
}
