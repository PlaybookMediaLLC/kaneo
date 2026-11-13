import { useTranslation } from "react-i18next";
import type { PortalPostSummary } from "../../../api/feedback/portal-post-summary.type";
import { portalHref } from "../../../core/portal-href";
export interface RecentPostListProps {
  posts: PortalPostSummary[];
  workspaceId: string;
}
export function RecentPostList({ posts, workspaceId }: RecentPostListProps) {
  const { t } = useTranslation("quills");
  return (
    <section aria-labelledby="recent-posts">
      <h2 id="recent-posts">{t("feedback.recentPosts")}</h2>
      {posts.length ? (
        <ul>
          {posts.map((post) => (
            <li key={post.id}>
              <a href={portalHref(workspaceId, `posts/${post.id}`)}>
                {post.title}
              </a>
              <span>{t("post.votes", { count: post.voteCount })}</span>
              <span>
                {t("feedback.comments", { count: post.commentCount })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("feedback.noPosts")}</p>
      )}
    </section>
  );
}
