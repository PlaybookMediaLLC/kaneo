import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetPortalPostResponse } from "../../../api/feedback/get-portal-post";
import type { ListPortalPostCommentsResponse } from "../../../api/feedback/list-portal-post-comments";
import { portalHref } from "../../../core/portal-href";
import type { PortalProblem, Viewer } from "../../../core/types";
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
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../../ui/upstream";
import { CreateCommentForm } from "./create-comment-form";
import { EditCommentForm } from "./edit-comment-form";
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
      {props.viewer.kind === "user" && props.post.canComment ? (
        <CreateCommentForm
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
        comments={props.comments}
        onEdit={setEditCommentId}
        onDelete={setDeleteCommentId}
      />
      <Sheet open={editPostOpen} onOpenChange={setEditPostOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.editPost")}</SheetTitle>
          </SheetHeader>
          <EditPostForm
            title={props.post.title}
            content={props.post.content}
            onSubmit={async (values) => {
              const result = await runMutation(() =>
                editPost.mutateAsync({
                  param: { workspace: props.workspaceId, postId: props.postId },
                  json: values,
                }),
              );
              if (!result) setEditPostOpen(false);
              return result;
            }}
          />
        </SheetContent>
      </Sheet>
      <Sheet open={deletePostOpen} onOpenChange={setDeletePostOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.deletePost")}</SheetTitle>
          </SheetHeader>
          <StateView
            problem={deletePost.error}
            onRetry={() => deletePost.reset()}
          >
            <ConfirmAction
              labelKey="post.deletePostConfirm"
              onConfirm={async () => {
                await deletePost.mutateAsync({
                  param: { workspace: props.workspaceId, postId: props.postId },
                });
                window.location.assign(portalHref(props.workspaceId));
              }}
            />
          </StateView>
        </SheetContent>
      </Sheet>
      <Sheet
        open={Boolean(selectedComment)}
        onOpenChange={(open) => !open && setEditCommentId(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.editComment")}</SheetTitle>
          </SheetHeader>
          {selectedComment ? (
            <EditCommentForm
              content={selectedComment.content}
              onSubmit={async (values) => {
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
          ) : null}
        </SheetContent>
      </Sheet>
      <Sheet
        open={Boolean(deleteCommentId)}
        onOpenChange={(open) => !open && setDeleteCommentId(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("post.deleteComment")}</SheetTitle>
          </SheetHeader>
          <StateView
            problem={deleteComment.error}
            onRetry={() => deleteComment.reset()}
          >
            <ConfirmAction
              labelKey="post.deleteCommentConfirm"
              onConfirm={async () => {
                if (!deleteCommentId) return;
                await deleteComment.mutateAsync({
                  param: {
                    workspace: props.workspaceId,
                    commentId: deleteCommentId,
                  },
                });
                setDeleteCommentId(null);
              }}
            />
          </StateView>
        </SheetContent>
      </Sheet>
    </>
  );
}

async function runMutation<T>(
  mutation: () => Promise<T>,
): Promise<PortalProblem | void> {
  try {
    await mutation();
  } catch (problem) {
    return problem as PortalProblem;
  }
}
