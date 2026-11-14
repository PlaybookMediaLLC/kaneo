import { useTranslation } from "react-i18next";
import type { GetPostResponse } from "../../../api/team/get-post";
import type { ListPostCommentsResponse } from "../../../api/team/list-post-comments";
import { useTeamRuntime } from "../../../team/runtime";
import { MarkdownContent } from "../../../ui/markdown-content";
import { commentText, PostComment } from "../../../ui/post/post-comment";
import { Button } from "../../../ui/upstream";
import { CommentBox } from "./comment-box";

type Comment = ListPostCommentsResponse["items"][number];

export interface PostThreadProps {
  workspaceId: string;
  post: GetPostResponse;
  comments: readonly Comment[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/** The comments of a request: customer comments, team replies and private notes, with replies. */
export function PostThread(props: PostThreadProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const known = new Set(props.comments.map((comment) => comment.id));
  // A reply whose parent is not loaded shows at the top level.
  const childrenOf = (parentId: string | null) =>
    props.comments.filter((comment) =>
      parentId
        ? comment.parentId === parentId
        : !comment.parentId || !known.has(comment.parentId),
    );
  const render = (comment: Comment) => {
    const replies = childrenOf(comment.id);
    return (
      <PostComment
        key={comment.id}
        comment={{
          id: comment.id,
          parentId: comment.parentId,
          content: comment.content,
          author: {
            name: comment.authorName,
            avatarUrl: null,
            isTeamMember: comment.isTeamMember,
          },
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          deleted: Boolean(comment.deletedAt) || comment.isRemovedByTeam,
          isAuthor: false,
          canEdit: false,
          canDelete: false,
          pending: comment.moderationState === "pending",
          reactions: comment.reactions,
        }}
        replyForm={
          team.permissions.create
            ? (parentId, close) => (
                <CommentBox
                  workspaceId={props.workspaceId}
                  postId={props.post.id}
                  parentId={parentId}
                  label={t("team-post.replyTo", {
                    name: comment.authorName ?? t("team-post.anonymous"),
                  })}
                  onSent={close}
                />
              )
            : undefined
        }
        body={
          comment.isPrivate ? (
            <div className="mt-1 rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("team-post.note")}
              </p>
              <MarkdownContent
                content={comment.content}
                className={commentText}
              />
            </div>
          ) : undefined
        }
      >
        {replies.length ? replies.map(render) : undefined}
      </PostComment>
    );
  };
  return (
    <section aria-labelledby="team-post-thread" className="grid gap-4">
      <h2 id="team-post-thread" className="text-sm font-semibold">
        {t("team-post.thread", { count: props.post.commentCount })}
      </h2>
      {props.comments.length ? (
        <ol className="grid gap-5">{childrenOf(null).map(render)}</ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("team-post.noReplies")}
        </p>
      )}
      {props.hasMore ? (
        <Button
          variant="ghost"
          loading={props.loadingMore}
          onClick={props.onLoadMore}
        >
          {t("team-post.loadMore")}
        </Button>
      ) : null}
    </section>
  );
}
