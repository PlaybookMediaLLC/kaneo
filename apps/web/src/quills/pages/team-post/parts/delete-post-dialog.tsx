import { useTranslation } from "react-i18next";
import { useDeletePost } from "../../../hooks/team/use-delete-post";
import { useTeamRuntime } from "../../../team/runtime";
import { Button, Dialog, DialogPopup, DialogTitle } from "../../../ui/upstream";

export interface DeletePostDialogProps {
  workspaceId: string;
  postId: string;
  onClose: () => void;
  /** Runs after the delete, for example to go back to the list. */
  onDeleted: () => void;
}

/** Asks before a request is deleted. A teammate with the delete action can restore it for 30 days. */
export function DeletePostDialog(props: DeletePostDialogProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const remove = useDeletePost(team.viewer);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup showCloseButton={false} className="gap-3 p-6">
        <DialogTitle>{t("team-post.deleteTitle")}</DialogTitle>
        <p className="text-sm text-muted-foreground">
          {t("team-post.deleteText")}
        </p>
        {remove.error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {t("core.problem.failed")}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t("team-post.cancel")}
          </Button>
          <Button
            variant="destructive"
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(
                {
                  param: {
                    workspaceId: props.workspaceId,
                    postId: props.postId,
                  },
                },
                { onSuccess: props.onDeleted },
              )
            }
          >
            {t("team-post.delete")}
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
