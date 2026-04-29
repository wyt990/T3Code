import { type ReactNode } from "react";

import {
  RIGHT_PANEL_SHEET_DIFF_CLASS_NAME,
  RIGHT_PANEL_SHEET_PLAN_CLASS_NAME,
} from "../rightPanelLayout";
import { Sheet, SheetPopup } from "./ui/sheet";

export function RightPanelSheet(props: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  /**
   * Plan/task sidebar matches the inline column width; diff needs a wider drawer
   * (see `rightPanelLayout.ts`).
   */
  variant?: "plan" | "diff";
}) {
  const sheetClassName =
    props.variant === "diff"
      ? RIGHT_PANEL_SHEET_DIFF_CLASS_NAME
      : RIGHT_PANEL_SHEET_PLAN_CLASS_NAME;
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup side="right" showCloseButton={false} keepMounted className={sheetClassName}>
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
