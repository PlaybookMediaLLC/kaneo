import { useTranslation } from "react-i18next";
import type { Viewer, PortalProblem } from "../../../core/types";
import type { ListPortalPostCommentsResponse } from "../../../api/feedback/list-portal-post-comments";
import { PortalSheetContent } from "../../../ui/portal-sheet-content";
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetPanel,
} from "../../../ui/upstream";
import { EditCommentForm } from "./edit-comment-form";
export interface EditCommentSheetProps {
  comment: ListPortalPostCommentsResponse["items"][number] | undefined;
  workspaceId: string;
  viewer: Viewer;
  onClose: () => void;
  onSubmit: (values: {
    content: string;
    attachmentIds?: string[];
  }) => Promise<PortalProblem | void>;
}
export function EditCommentSheet(props: EditCommentSheetProps) {
  const { t } = useTranslation("quills");
  return (
    <Sheet
      open={Boolean(props.comment)}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <PortalSheetContent>
        <SheetHeader>
          <SheetTitle>{t("post.editComment")}</SheetTitle>
        </SheetHeader>
        <SheetPanel>
          {props.comment ? (
            <EditCommentForm
              key={props.comment.id}
              workspaceId={props.workspaceId}
              viewer={props.viewer}
              content={props.comment.content}
              attachments={props.comment.attachments}
              onSubmit={props.onSubmit}
            />
          ) : null}
        </SheetPanel>
      </PortalSheetContent>
    </Sheet>
  );
}
