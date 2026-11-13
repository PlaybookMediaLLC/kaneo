import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../markdown-content";
import { Card, CardContent, CardHeader, CardTitle } from "../upstream";

export interface PostDetailProps {
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

export function PostDetail({ post }: PostDetailProps) {
  const { t } = useTranslation("quills");
  const author = post.author.name?.trim() || t("post.anonymousAuthor");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{post.title}</CardTitle>
        <p>{t("post.author", { name: author })}</p>
        {post.pending ? <p role="status">{t("post.pending")}</p> : null}
      </CardHeader>
      <CardContent>
        <MarkdownContent content={post.content} />
        <dl>
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
