import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ListPortalPostCommentsResponse } from "../../../api/feedback/list-portal-post-comments";
import type { SetPortalCommentReactionRequest } from "../../../api/feedback/set-portal-comment-reaction";
import { portalHref } from "../../../core/portal-href";
import type { Viewer } from "../../../core/types";
import { useCreatePortalComment } from "../../../hooks/feedback/use-create-portal-comment";
import { useSetPortalCommentReaction } from "../../../hooks/feedback/use-set-portal-comment-reaction";
import { commentText, PostComment } from "../../../ui/post/post-comment";
import { Button } from "../../../ui/upstream";
import { visibleComments } from "../../../core/visible-comments";
import { runMutation } from "../run-mutation";
import { CommentSheets } from "./comment-sheets";
import { CreateCommentForm } from "./create-comment-form";
import { PostAttachments } from "./post-attachments";
import { browserLocale, TranslatedText } from "./translated-text";

type Comment = ListPortalPostCommentsResponse["items"][number];
type Emoji = SetPortalCommentReactionRequest["json"]["emoji"];

export interface PostCommentsSectionProps {
  workspaceId: string;
  postId: string;
  viewer: Viewer;
  canComment: boolean;
  /** The thread takes new comments, so a visitor is asked to sign in. */
  open: boolean;
  /** The total when more pages remain; the visible comments are counted without it. */
  count?: number;
  comments: Comment[];
  /** Loads the next page; the control is hidden without it. */
  onLoadMore?: () => void;
  loadingMore?: boolean;
  /** False when the instance has no AI provider; then comments offer no translation. */
  translatable?: boolean;
}

/** The comment count, the composer and the threaded comments with likes and replies. */
export function PostCommentsSection(props: PostCommentsSectionProps) {
  const { t } = useTranslation("quills");
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const create = useCreatePortalComment(props.viewer);
  const react = useSetPortalCommentReaction(props.viewer);
  const signedIn = props.viewer.kind === "user";
  // English readers get the plain comment, with no translation query for each comment.
  const translatable = browserLocale() !== null;
  // Comments load oldest first, so a new one can fall past the loaded pages.
  // ponytail: an edit of such a comment shows the old text until the page reloads;
  // keep the edit response here if people edit fresh comments on long threads.
  const [created, setCreated] = useState<Comment[]>([]);
  // The reactions from each reaction reply, which can be newer than the loaded pages.
  const [reacted, setReacted] = useState<Record<string, Comment["reactions"]>>(
    {},
  );
  const loaded = new Set(props.comments.map((comment) => comment.id));
  const all = [
    ...props.comments,
    ...created.filter((comment) => !loaded.has(comment.id)),
  ];
  const comments = visibleComments(all);
  const ids = new Set(comments.map((comment) => comment.id));
  const top = comments.filter(
    (comment) => !comment.parentId || !ids.has(comment.parentId),
  );
  const submit =
    (parentId?: string) =>
    (values: {
      content: string;
      attachmentIds?: string[];
      idempotencyKey?: string;
    }) =>
      runMutation(async () => {
        const comment = await create.mutateAsync({
          param: { workspace: props.workspaceId, postId: props.postId },
          json: { ...values, parentId },
        });
        setCreated((items) => [...items, comment]);
      });
  const replies = (id: string) =>
    comments.filter((reply) => reply.parentId === id);
  const render = (comment: Comment) => (
    <PostComment
      key={comment.id}
      comment={{
        ...comment,
        reactions: reacted[comment.id] ?? comment.reactions,
      }}
      body={
        translatable ? (
          <TranslatedText
            translatable={props.translatable}
            workspaceId={props.workspaceId}
            viewer={props.viewer}
            target={{ commentId: comment.id }}
            content={comment.content}
            className={commentText}
          />
        ) : undefined
      }
      attachments={
        <PostAttachments
          workspaceId={props.workspaceId}
          viewer={props.viewer}
          attachments={comment.attachments}
        />
      }
      onEdit={setEditId}
      onDelete={setDeleteId}
      onReact={
        signedIn
          ? (commentId, emoji, reacted) =>
              react
                .mutateAsync({
                  param: { workspace: props.workspaceId, commentId },
                  json: { emoji: emoji as Emoji, reacted },
                })
                .then((result) =>
                  setReacted((items) => ({
                    ...items,
                    [commentId]: result.reactions,
                  })),
                )
          : undefined
      }
      replyForm={
        signedIn && props.canComment
          ? (parentId, close) => (
              <CreateCommentForm
                workspaceId={props.workspaceId}
                viewer={props.viewer}
                autoFocus
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
      {replies(comment.id).length ? replies(comment.id).map(render) : null}
    </PostComment>
  );

  return (
    <section aria-labelledby="post-comments-heading" className="mt-12">
      <h2 id="post-comments-heading" className="mb-4 text-sm font-medium">
        {t("post.commentCount", {
          count:
            props.count ??
            comments.filter((comment) => !comment.deleted).length,
        })}
      </h2>
      {signedIn && props.canComment ? (
        <CreateCommentForm
          workspaceId={props.workspaceId}
          viewer={props.viewer}
          onSubmit={submit()}
        />
      ) : !signedIn && props.open ? (
        <a
          className="block rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-xs transition-shadow hover:shadow-sm"
          href={`/auth/sign-in?redirect=${encodeURIComponent(portalHref(props.workspaceId, `posts/${props.postId}`))}`}
        >
          {t("post.commentPlaceholder")}
          <span className="sr-only"> {t("post.signInToComment")}</span>
        </a>
      ) : null}
      {top.length ? (
        <ul className="mt-8 grid gap-6">{top.map(render)}</ul>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          {t("post.noComments")}
        </p>
      )}
      {props.onLoadMore ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-4 w-full text-muted-foreground"
          loading={props.loadingMore}
          onClick={props.onLoadMore}
        >
          {t("post.loadMore")}
        </Button>
      ) : null}
      <CommentSheets
        workspaceId={props.workspaceId}
        viewer={props.viewer}
        comment={comments.find((comment) => comment.id === editId)}
        deleteId={deleteId}
        onEditDone={() => setEditId(null)}
        onDeleted={(id) =>
          setCreated((items) => items.filter((item) => item.id !== id))
        }
        onDeleteDone={() => setDeleteId(null)}
      />
    </section>
  );
}
