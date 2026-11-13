import { useTranslation } from "react-i18next";

export interface PostCommentsProps {
  comments: Array<{
    id: string;
    content: string;
    author: { name: string | null };
    createdAt: string;
    deleted: boolean;
    isAuthor: boolean;
    canEdit: boolean;
    canDelete: boolean;
    pending: boolean;
    updatedAt: string | null;
  }>;
  onDelete?: (commentId: string) => void;
  onEdit?: (commentId: string) => void;
}

export function PostComments({
  comments,
  onDelete,
  onEdit,
}: PostCommentsProps) {
  const { t } = useTranslation("quills");
  return (
    <section aria-labelledby="post-comments-heading">
      <h2 id="post-comments-heading">{t("post.comments")}</h2>
      {comments.length ? (
        <ul>
          {comments.map((comment) => {
            const author =
              comment.author.name?.trim() || t("post.anonymousAuthor");
            return (
              <li key={comment.id}>
                <p>{t("post.author", { name: author })}</p>
                <p>
                  {comment.deleted ? t("post.deletedComment") : comment.content}
                </p>
                {comment.pending ? (
                  <p role="status">{t("post.pending")}</p>
                ) : null}
                {comment.updatedAt ? <span>{t("post.edited")}</span> : null}
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
                {comment.isAuthor &&
                !comment.deleted &&
                (comment.canEdit || comment.canDelete) ? (
                  <div aria-label={t("post.actions")}>
                    {comment.canEdit ? (
                      <button
                        type="button"
                        onClick={() => onEdit?.(comment.id)}
                      >
                        {t("post.editComment")}
                      </button>
                    ) : null}
                    {comment.canDelete ? (
                      <button
                        type="button"
                        onClick={() => onDelete?.(comment.id)}
                      >
                        {t("post.deleteComment")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>{t("post.noComments")}</p>
      )}
    </section>
  );
}
