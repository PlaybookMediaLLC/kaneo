import { useTranslation } from "react-i18next";
import { PortalSheetContent } from "../../../ui/portal-sheet-content";
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "../../../ui/upstream";
import { AcceptPostForm, type AcceptPostFormProps } from "./accept-post-form";
import type { Signal } from "./signal-detail";

export interface AcceptPostSheetProps {
  /** The signal to accept. Null closes the sheet. */
  signal: Signal | null;
  boards: AcceptPostFormProps["boards"];
  onClose: () => void;
  onSubmit: AcceptPostFormProps["onSubmit"];
}

/** The sheet that turns a signal into a new post on a board. */
export function AcceptPostSheet({
  signal,
  boards,
  onClose,
  onSubmit,
}: AcceptPostSheetProps) {
  const { t } = useTranslation("quills");
  return (
    <Sheet open={Boolean(signal)} onOpenChange={(open) => !open && onClose()}>
      <PortalSheetContent>
        <SheetHeader>
          <SheetTitle>{t("autopilot.sheetTitle")}</SheetTitle>
        </SheetHeader>
        <SheetPanel>
          {signal ? (
            <AcceptPostForm
              key={signal.id}
              boards={boards}
              title={signal.suggestedTitle}
              onSubmit={onSubmit}
            />
          ) : null}
        </SheetPanel>
      </PortalSheetContent>
    </Sheet>
  );
}
