import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../markdown-content";
import { Card, CardContent, CardHeader, CardTitle } from "../upstream";

export interface PostDetailProps {
  hideTitle?: boolean;
  post: {
    title: string;
    content: string;
    author: { name: string | null };
    board: { name: string };
    status: { name: string } | null;
    pending: boolean;
    mergedInto: { title: string } | null;
  };
}

export function PostDetail({ post, hideTitle }: PostDetailProps) {
  const { t } = useTranslation("quills");
  const author = post.author.name?.trim() || t("post.anonymousAuthor");
  return (
    <Card className="portal-detail-card mb-7 rounded-2xl shadow-none [&_[data-slot=card-title]]:text-2xl [&_[data-slot=card-title]]:leading-snug [&_[data-slot=card-title]]:tracking-tight [&_[data-slot=card-header]>p]:text-sm [&_[data-slot=card-header]>p]:text-muted-foreground">
      <CardHeader>
        {hideTitle ? null : <CardTitle>{post.title}</CardTitle>}
        <p>{t("post.author", { name: author })}</p>
        {post.pending ? <p role="status">{t("post.pending")}</p> : null}
      </CardHeader>
      <CardContent>
        <MarkdownContent content={post.content} />
        <dl className="portal-metadata mt-7 flex flex-wrap gap-8 border-t border-border pt-5 [&_dt]:mb-1 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:text-sm [&_dd]:font-medium">
          <div>
            <dt>{t("post.board")}</dt>
            <dd>{post.board.name}</dd>
          </div>
          {post.status ? (
            <div>
              <dt>{t("post.status")}</dt>
              <dd>{post.status.name}</dd>
            </div>
          ) : null}
        </dl>
        {post.mergedInto ? (
          <p>{t("post.mergedInto", { title: post.mergedInto.title })}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
