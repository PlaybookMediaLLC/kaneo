import { IconHeartOutline18 } from "nucleo-ui-essential-outline-18";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../../core/relative-time";
import { ConfirmAction } from "../confirm-action";
import { PersonAvatar } from "../person-avatar";

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
  /** Toggles the like; the like is read-only without it. */
  onLike?: (commentId: string, liked: boolean) => Promise<void>;
  /** The reply form; the Reply control is hidden without it. */
  replyForm?: (parentId: string, close: () => void) => ReactNode;
  /** Replies, shown under the comment. */
  children?: ReactNode;
}

const LIKE = "❤️";

const action =
  "text-xs text-muted-foreground transition-colors hover:text-foreground";
// Resets the upstream button so the like matches the other text actions.
const like = `${action} h-auto gap-1 border-0 bg-transparent px-0 font-normal shadow-none before:hidden hover:bg-transparent aria-pressed:bg-transparent aria-pressed:text-foreground sm:h-auto sm:text-xs dark:bg-transparent [&_svg]:size-3.5`;

/** One comment with its likes, reply control, author actions and replies. */
export function PostComment({ comment, ...props }: PostCommentProps) {
  const { t, i18n } = useTranslation("quills");
  const [replying, setReplying] = useState(false);
  const author = comment.author.name?.trim() || t("post.anonymousAuthor");
  const liked = comment.reactions.find((item) => item.emoji === LIKE);
  const others = comment.reactions.filter(
    (item) => item.emoji !== LIKE && item.count > 0,
  );
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
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
        <p
          className={`mt-1 whitespace-pre-wrap break-words text-sm ${comment.deleted ? "italic text-muted-foreground" : ""}`}
        >
          {comment.deleted ? t("post.deletedComment") : comment.content}
        </p>
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
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ConfirmAction
                labelKey="post.like"
                pressed={Boolean(liked?.reacted)}
                disabled={!props.onLike}
                className={like}
                onConfirm={() => props.onLike!(comment.id, !liked?.reacted)}
              >
                <IconHeartOutline18 aria-hidden="true" />
              </ConfirmAction>
              {liked?.count ? <span>{liked.count}</span> : null}
            </span>
            {others.map((item) => (
              <span key={item.emoji} className="text-xs text-muted-foreground">
                {item.emoji} {item.count}
              </span>
            ))}
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
