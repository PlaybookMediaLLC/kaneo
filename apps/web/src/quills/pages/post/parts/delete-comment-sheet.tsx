import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { PortalSheetContent } from "../../../ui/portal-sheet-content";
import { StateView } from "../../../ui/state-view";
import { ConfirmAction } from "../../../ui/confirm-action";
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetPanel,
} from "../../../ui/upstream";
export interface DeleteCommentSheetProps {
  open: boolean;
  onClose: () => void;
  problem: PortalProblem | null;
  onRetry: () => void;
  onConfirm: () => Promise<void>;
}
export function DeleteCommentSheet(props: DeleteCommentSheetProps) {
  const { t } = useTranslation("quills");
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <PortalSheetContent>
        <SheetHeader>
          <SheetTitle>{t("post.deleteComment")}</SheetTitle>
        </SheetHeader>
        <SheetPanel>
          <StateView problem={props.problem} onRetry={props.onRetry}>
            <ConfirmAction
              labelKey="post.deleteCommentConfirm"
              onConfirm={props.onConfirm}
            />
          </StateView>
        </SheetPanel>
      </PortalSheetContent>
    </Sheet>
  );
}
