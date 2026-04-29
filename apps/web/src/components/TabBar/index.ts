export { TabBar } from "./TabBar";
export { TabContentArea, type MergedPairContext } from "./TabContentArea";
export { TabbedShell } from "./TabbedShell";
export { SplitLayout } from "./SplitLayout";
export { pointerXToSplitRatio, snapToHalfRatio } from "./SplitLayout.logic";
export {
  decideTabActivation,
  nextTabId,
  pickLeastRecentlyVisitedTabId,
  pickNextActiveTabAfterClose,
  resolveTabTitle,
  tabTargetKey,
  type TabActivationDecision,
  type TabTitleInputs,
} from "./TabBar.logic";
