import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ListPortalPostCommentsResponse } from "../../../api/feedback/list-portal-post-comments";
import { portalHref } from "../../../core/portal-href";
import type { Viewer } from "../../../core/types";
import { useCreatePortalComment } from "../../../hooks/feedback/use-create-portal-comment";
import { useSetPortalCommentReaction } from "../../../hooks/feedback/use-set-portal-comment-reaction";
import { PostComment } from "../../../ui/post/post-comment";
import { runMutation } from "../run-mutation";
import { CommentSheets } from "./comment-sheets";
import { CreateCommentForm } from "./create-comment-form";

type Comment = ListPortalPostCommentsResponse["items"][number];

export interface PostCommentsSectionProps {
  workspaceId: string;
  postId: string;
  viewer: Viewer;
  canComment: boolean;
  comments: Comment[];
}

/** The comment count, the composer and the threaded comments with likes and replies. */
export function PostCommentsSection(props: PostCommentsSectionProps) {
  const { t } = useTranslation("quills");
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const create = useCreatePortalComment(props.viewer);
  const react = useSetPortalCommentReaction(props.viewer);
  const signedIn = props.viewer.kind === "user";
  const ids = new Set(props.comments.map((comment) => comment.id));
  const top = props.comments.filter(
    (comment) => !comment.parentId || !ids.has(comment.parentId),
  );
  const submit = (parentId?: string) => (values: { content: string }) =>
    runMutation(() =>
      create.mutateAsync({
        param: { workspace: props.workspaceId, postId: props.postId },
        json: { ...values, parentId },
      }),
    );
  const render = (comment: Comment) => (
    <PostComment
      key={comment.id}
      comment={comment}
      onEdit={setEditId}
      onDelete={setDeleteId}
      onLike={
        signedIn
          ? (commentId, reacted) =>
              react
                .mutateAsync({
                  param: { workspace: props.workspaceId, commentId },
                  json: { emoji: "❤️", reacted },
                })
                .then(() => undefined)
          : undefined
      }
      replyForm={
        signedIn && props.canComment
          ? (parentId, close) => (
              <CreateCommentForm
                onSubmit={async (values) => {
                  const problem = await submit(parentId)(values);
                  if (!problem) close();
                  return problem;
                }}
              />
            )
          : undefined
      }
    >
      {props.comments
        .filter((reply) => reply.parentId === comment.id)
        .map(render)}
    </PostComment>
  );

  return (
    <section aria-labelledby="post-comments-heading" className="mt-12">
      <h2 id="post-comments-heading" className="mb-4 text-sm font-medium">
        {t("post.commentCount", {
          count: props.comments.filter((comment) => !comment.deleted).length,
        })}
      </h2>
      {signedIn && props.canComment ? (
        <CreateCommentForm onSubmit={submit()} />
      ) : props.canComment ? (
        <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
          {t("post.signInToComment")}{" "}
          <a
            className="font-medium text-foreground underline-offset-4 hover:underline"
            href={`/auth/sign-in?redirect=${encodeURIComponent(portalHref(props.workspaceId, `posts/${props.postId}`))}`}
          >
            {t("post.signIn")}
          </a>
        </p>
      ) : null}
      {top.length ? (
        <ul className="mt-8 grid gap-6">{top.map(render)}</ul>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          {t("post.noComments")}
        </p>
      )}
      <CommentSheets
        workspaceId={props.workspaceId}
        viewer={props.viewer}
        comment={props.comments.find((comment) => comment.id === editId)}
        deleteId={deleteId}
        onEditDone={() => setEditId(null)}
        onDeleteDone={() => setDeleteId(null)}
      />
    </section>
  );
}
