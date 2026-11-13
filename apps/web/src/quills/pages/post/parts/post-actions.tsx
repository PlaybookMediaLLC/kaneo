import { useTranslation } from "react-i18next";
import { portalHref } from "../../../core/portal-href";
import type { Viewer } from "../../../core/types";
import { useDeletePortalOwnPost } from "../../../hooks/feedback/use-delete-portal-own-post";
import { useEditPortalOwnPost } from "../../../hooks/feedback/use-edit-portal-own-post";
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
import { EditPostForm } from "./edit-post-form";

export interface PostActionsProps {
  post: { title: string; content: string };
  postId: string;
  viewer: Viewer;
  workspaceId: string;
  editOpen: boolean;
  deleteOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  onDeleteOpenChange: (open: boolean) => void;
}

/** The sheets behind the rail's edit and delete actions for the viewer's own post. */
export function PostActions(props: PostActionsProps) {
  const { t } = useTranslation("quills");
  const editPost = useEditPortalOwnPost(props.viewer);
  const deletePost = useDeletePortalOwnPost(props.viewer);
  const param = { workspace: props.workspaceId, postId: props.postId };
  return (
    <>
      <Sheet open={props.editOpen} onOpenChange={props.onEditOpenChange}>
        <PortalSheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.editPost")}</SheetTitle>
          </SheetHeader>
          <SheetPanel>
            <EditPostForm
              title={props.post.title}
              content={props.post.content}
              onSubmit={async (values) => {
                const result = await runMutation(() =>
                  editPost.mutateAsync({ param, json: values }),
                );
                if (!result) props.onEditOpenChange(false);
                return result;
              }}
            />
          </SheetPanel>
        </PortalSheetContent>
      </Sheet>
      <Sheet open={props.deleteOpen} onOpenChange={props.onDeleteOpenChange}>
        <PortalSheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.deletePost")}</SheetTitle>
          </SheetHeader>
          <SheetPanel>
            <StateView
              problem={deletePost.error}
              onRetry={() => deletePost.reset()}
            >
              <ConfirmAction
                labelKey="post.deletePostConfirm"
                onConfirm={async () => {
                  await deletePost.mutateAsync({ param });
                  window.location.assign(portalHref(props.workspaceId));
                }}
              />
            </StateView>
          </SheetPanel>
        </PortalSheetContent>
      </Sheet>
    </>
  );
}
