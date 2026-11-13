import type { ReactNode } from "react";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../upstream";
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
  renderAttachments?: (commentId: string) => ReactNode;
  onDelete?: (commentId: string) => void;
  onEdit?: (commentId: string) => void;
}

export function PostComments({
  comments,
  renderAttachments,
  onDelete,
  onEdit,
}: PostCommentsProps) {
  const { t } = useTranslation("quills");
  return (
    <section
      className="portal-comments mt-8 [&>h2]:mb-5 [&>h2]:text-base [&>h2]:font-semibold [&_li]:grid [&_li]:gap-3 [&_li]:border-t [&_li]:border-border [&_li]:py-6 [&_li>p:first-child]:text-sm [&_li>p:first-child]:font-medium [&_li>[aria-label]]:flex [&_li>[aria-label]]:gap-4 [&_li>[aria-label]]:text-xs [&_li>[aria-label]]:text-muted-foreground"
      aria-labelledby="post-comments-heading"
    >
      <h2 id="post-comments-heading">{t("post.comments")}</h2>
      {comments.length ? (
        <ul>
          {comments.map((comment) => {
            const author =
              comment.author.name?.trim() || t("post.anonymousAuthor");
            return (
              <li key={comment.id}>
                <p>{t("post.author", { name: author })}</p>
                {comment.deleted ? (
                  <p>{t("post.deletedComment")}</p>
                ) : (
                  <>
                    <MarkdownContent content={comment.content} />
                    {renderAttachments?.(comment.id)}
                  </>
                )}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => onEdit?.(comment.id)}
                      >
                        {t("post.editComment")}
                      </Button>
                    ) : null}
                    {comment.canDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => onDelete?.(comment.id)}
                      >
                        {t("post.deleteComment")}
                      </Button>
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
