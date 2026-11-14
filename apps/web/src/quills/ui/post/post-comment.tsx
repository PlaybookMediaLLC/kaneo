import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../../core/relative-time";
import { MarkdownContent } from "../markdown-content";
import { PersonAvatar } from "../person-avatar";
import { cn } from "../upstream";
import { CommentReactions } from "./comment-reactions";

interface CommentItem {
  id: string;
  parentId: string | null;
  content: string;
  author: {
    name: string | null;
    avatarUrl: string | null;
    isTeamMember: boolean;
  };
  createdAt: string;
  updatedAt: string | null;
  deleted: boolean;
  isAuthor: boolean;
  canEdit: boolean;
  canDelete: boolean;
  pending: boolean;
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
}

export interface PostCommentProps {
  comment: CommentItem;
  onEdit?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  /** Toggles a reaction; the reactions are read-only without it. */
  onReact?: (
    commentId: string,
    emoji: string,
    reacted: boolean,
  ) => Promise<void>;
  /** The reply form; the Reply control is hidden without it. */
  replyForm?: (parentId: string, close: () => void) => ReactNode;
  /** The comment's text; the stored text by default. */
  body?: ReactNode;
  /** The comment's files, shown under its text. */
  attachments?: ReactNode;
  /** Replies, shown under the comment. */
  children?: ReactNode;
}

const action =
  "text-xs text-muted-foreground transition-colors hover:text-foreground";
/** The style of a comment's text, for a `body` that replaces it. */
export const commentText =
  "mt-1 text-sm leading-relaxed [&>*+*]:mt-2 [&_p]:whitespace-pre-line";

/** One comment with its likes, reply control, author actions and replies. */
export function PostComment({ comment, ...props }: PostCommentProps) {
  const { t, i18n } = useTranslation("quills");
  const [replying, setReplying] = useState(false);
  const author = comment.author.name?.trim() || t("post.anonymousAuthor");
  return (
    <li
      className={cn(
        "grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3",
        // A team reply stands out, so customers see the official answer.
        comment.author.isTeamMember &&
          !comment.deleted &&
          "-mx-3 rounded-xl bg-primary/5 p-3 ring-1 ring-primary/15 ring-inset",
      )}
    >
      <PersonAvatar
        name={author}
        avatarUrl={comment.author.avatarUrl}
        className="size-7 text-xs"
      />
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{author}</span>
          {comment.author.isTeamMember ? (
            <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">
              {t("post.team")}
            </span>
          ) : null}
          <time
            dateTime={comment.createdAt}
            title={new Date(comment.createdAt).toLocaleString(i18n.language)}
          >
            {relativeTime(comment.createdAt, i18n.language)}
          </time>
          {comment.updatedAt ? (
            <span className="text-xs text-muted-foreground">
              {t("post.edited")}
            </span>
          ) : null}
        </p>
        {comment.deleted ? (
          <p className="mt-1 text-sm italic text-muted-foreground">
            {t("post.deletedComment")}
          </p>
        ) : (
          <>
            {props.body ?? (
              <MarkdownContent
                customer
                content={comment.content}
                className={commentText}
              />
            )}
            {props.attachments}
          </>
        )}
        {comment.pending ? (
          <p role="status" className="mt-1 text-xs text-muted-foreground">
            {t("post.pending")}
          </p>
        ) : null}
        {comment.deleted ? null : (
          <div
            aria-label={t("post.commentActions")}
            role="group"
            className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1"
          >
            <CommentReactions
              reactions={comment.reactions}
              onReact={
                props.onReact
                  ? (emoji, reacted) =>
                      props.onReact!(comment.id, emoji, reacted)
                  : undefined
              }
            />
            {props.replyForm ? (
              <button
                type="button"
                className={action}
                aria-expanded={replying}
                onClick={() => setReplying(!replying)}
              >
                {t("post.reply")}
              </button>
            ) : null}
            {comment.isAuthor && comment.canEdit && props.onEdit ? (
              <button
                type="button"
                className={action}
                onClick={() => props.onEdit!(comment.id)}
              >
                {t("post.editComment")}
              </button>
            ) : null}
            {comment.isAuthor && comment.canDelete && props.onDelete ? (
              <button
                type="button"
                className={action}
                onClick={() => props.onDelete!(comment.id)}
              >
                {t("post.deleteComment")}
              </button>
            ) : null}
          </div>
        )}
        {replying && props.replyForm ? (
          <div className="mt-3">
            {props.replyForm(comment.id, () => setReplying(false))}
          </div>
        ) : null}
        {props.children ? (
          <ul className="mt-5 grid gap-5">{props.children}</ul>
        ) : null}
      </div>
    </li>
  );
}
