import { DeleteCommentSheet } from "./delete-comment-sheet";
import { PostAttachments } from "./post-attachments";
import { runMutation } from "../run-mutation";
import { PortalSheetContent } from "../../../ui/portal-sheet-content";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPortalPostResponse } from "../../../api/feedback/get-portal-post";
import type { ListPortalPostCommentsResponse } from "../../../api/feedback/list-portal-post-comments";
import { portalHref } from "../../../core/portal-href";
import type { Viewer } from "../../../core/types";
import { useCreatePortalComment } from "../../../hooks/feedback/use-create-portal-comment";
import { useDeletePortalOwnComment } from "../../../hooks/feedback/use-delete-portal-own-comment";
import { useDeletePortalOwnPost } from "../../../hooks/feedback/use-delete-portal-own-post";
import { useEditPortalOwnComment } from "../../../hooks/feedback/use-edit-portal-own-comment";
import { useEditPortalOwnPost } from "../../../hooks/feedback/use-edit-portal-own-post";
import { ConfirmAction } from "../../../ui/confirm-action";
import { PostComments } from "../../../ui/post/post-comments";
import { StateView } from "../../../ui/state-view";
import {
  Button,
  Sheet,
  SheetPanel,
  SheetHeader,
  SheetTitle,
} from "../../../ui/upstream";
import { CreateCommentForm } from "./create-comment-form";
import { EditCommentSheet } from "./edit-comment-sheet";
import { EditPostForm } from "./edit-post-form";
export interface PostActionsProps {
  comments: ListPortalPostCommentsResponse["items"];
  post: GetPortalPostResponse;
  postId: string;
  viewer: Viewer;
  workspaceId: string;
}
export function PostActions(props: PostActionsProps) {
  const { t } = useTranslation("quills");
  const [editPostOpen, setEditPostOpen] = useState(false);
  const [deletePostOpen, setDeletePostOpen] = useState(false);
  const [editCommentId, setEditCommentId] = useState<string | null>(null);
  const [deleteCommentId, setDeleteCommentId] = useState<string | null>(null);
  const createComment = useCreatePortalComment(props.viewer);
  const editPost = useEditPortalOwnPost(props.viewer);
  const deletePost = useDeletePortalOwnPost(props.viewer);
  const editComment = useEditPortalOwnComment(props.viewer);
  const deleteComment = useDeletePortalOwnComment(props.viewer);
  const selectedComment = props.comments.find(
    (comment) => comment.id === editCommentId,
  );
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {props.post.canEdit ? (
          <Button type="button" onClick={() => setEditPostOpen(true)}>
            {t("post.editPost")}
          </Button>
        ) : null}
        {props.post.canDelete ? (
          <Button type="button" onClick={() => setDeletePostOpen(true)}>
            {t("post.deletePost")}
          </Button>
        ) : null}
      </div>
      {props.viewer.kind === "user" && props.post.canComment ? (
        <CreateCommentForm
          workspaceId={props.workspaceId}
          viewer={props.viewer}
          onSubmit={(values) =>
            runMutation(() =>
              createComment.mutateAsync({
                param: { workspace: props.workspaceId, postId: props.postId },
                json: values,
              }),
            )
          }
        />
      ) : props.post.canComment ? (
        <p>
          {t("post.signInToComment")}{" "}
          <a
            href={`/auth/sign-in?redirect=${encodeURIComponent(portalHref(props.workspaceId, `posts/${props.postId}`))}`}
          >
            {t("post.signIn")}
          </a>
        </p>
      ) : null}
      <PostComments
        renderAttachments={(id) => (
          <PostAttachments
            workspaceId={props.workspaceId}
            viewer={props.viewer}
            attachments={
              props.comments.find((comment) => comment.id === id)
                ?.attachments ?? []
            }
          />
        )}
        comments={props.comments}
        onEdit={setEditCommentId}
        onDelete={setDeleteCommentId}
      />
      <Sheet open={editPostOpen} onOpenChange={setEditPostOpen}>
        <PortalSheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.editPost")}</SheetTitle>
          </SheetHeader>
          <SheetPanel>
            <EditPostForm
              workspaceId={props.workspaceId}
              viewer={props.viewer}
              attachments={props.post.attachments}
              title={props.post.title}
              content={props.post.content}
              onSubmit={async (values) => {
                const result = await runMutation(() =>
                  editPost.mutateAsync({
                    param: {
                      workspace: props.workspaceId,
                      postId: props.postId,
                    },
                    json: values,
                  }),
                );
                if (!result) setEditPostOpen(false);
                return result;
              }}
            />
          </SheetPanel>
        </PortalSheetContent>
      </Sheet>
      <Sheet open={deletePostOpen} onOpenChange={setDeletePostOpen}>
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
                  await deletePost.mutateAsync({
                    param: {
                      workspace: props.workspaceId,
                      postId: props.postId,
                    },
                  });
                  window.location.assign(portalHref(props.workspaceId));
                }}
              />
            </StateView>
          </SheetPanel>
        </PortalSheetContent>
      </Sheet>
      <EditCommentSheet
        comment={selectedComment}
        workspaceId={props.workspaceId}
        viewer={props.viewer}
        onClose={() => setEditCommentId(null)}
        onSubmit={async (values) => {
          if (!selectedComment) return;
          const result = await runMutation(() =>
            editComment.mutateAsync({
              param: {
                workspace: props.workspaceId,
                commentId: selectedComment.id,
              },
              json: values,
            }),
          );
          if (!result) setEditCommentId(null);
          return result;
        }}
      />
      <DeleteCommentSheet
        open={Boolean(deleteCommentId)}
        onClose={() => setDeleteCommentId(null)}
        problem={deleteComment.error}
        onRetry={() => deleteComment.reset()}
        onConfirm={async () => {
          if (!deleteCommentId) return;
          await deleteComment.mutateAsync({
            param: { workspace: props.workspaceId, commentId: deleteCommentId },
          });
          setDeleteCommentId(null);
        }}
      />
    </>
  );
}
