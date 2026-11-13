import { useTranslation } from "react-i18next";
import type { Viewer } from "../../../core/types";
import { useDeletePortalOwnComment } from "../../../hooks/feedback/use-delete-portal-own-comment";
import { useEditPortalOwnComment } from "../../../hooks/feedback/use-edit-portal-own-comment";
import { ConfirmAction } from "../../../ui/confirm-action";
import { PortalSheetContent } from "../../../ui/portal-sheet-content";
import { StateView } from "../../../ui/state-view";
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "../../../ui/upstream";
import { runMutation } from "../run-mutation";
import { EditCommentForm } from "./edit-comment-form";

export interface CommentSheetsProps {
  workspaceId: string;
  viewer: Viewer;
  /** The comment being edited; the edit sheet is closed without one. */
  comment?: { id: string; content: string };
  /** The comment being deleted; the delete sheet is closed without one. */
  deleteId: string | null;
  onEditDone: () => void;
  onDeleteDone: () => void;
}

/** The edit and delete sheets for the viewer's own comments. */
export function CommentSheets(props: CommentSheetsProps) {
  const { t } = useTranslation("quills");
  const edit = useEditPortalOwnComment(props.viewer);
  const remove = useDeletePortalOwnComment(props.viewer);
  return (
    <>
      <Sheet
        open={Boolean(props.comment)}
        onOpenChange={(open) => !open && props.onEditDone()}
      >
        <PortalSheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.editComment")}</SheetTitle>
          </SheetHeader>
          <SheetPanel>
            {props.comment ? (
              <EditCommentForm
                content={props.comment.content}
                onSubmit={async (values) => {
                  const result = await runMutation(() =>
                    edit.mutateAsync({
                      param: {
                        workspace: props.workspaceId,
                        commentId: props.comment!.id,
                      },
                      json: values,
                    }),
                  );
                  if (!result) props.onEditDone();
                  return result;
                }}
              />
            ) : null}
          </SheetPanel>
        </PortalSheetContent>
      </Sheet>
      <Sheet
        open={Boolean(props.deleteId)}
        onOpenChange={(open) => !open && props.onDeleteDone()}
      >
        <PortalSheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.deleteComment")}</SheetTitle>
          </SheetHeader>
          <SheetPanel>
            <StateView problem={remove.error} onRetry={() => remove.reset()}>
              <ConfirmAction
                labelKey="post.deleteCommentConfirm"
                onConfirm={async () => {
                  if (!props.deleteId) return;
                  await remove.mutateAsync({
                    param: {
                      workspace: props.workspaceId,
                      commentId: props.deleteId,
                    },
                  });
                  props.onDeleteDone();
                }}
              />
            </StateView>
          </SheetPanel>
        </PortalSheetContent>
      </Sheet>
    </>
  );
}
