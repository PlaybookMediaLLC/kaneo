import { useTranslation } from "react-i18next";
import type { PortalPostSummary } from "../../../api/feedback/portal-post-summary.type";
import { portalHref } from "../../../core/portal-href";
import type { PortalProblem } from "../../../core/types";
import { PostVoteButton } from "../../../ui/post/post-vote-button";
import { Button } from "../../../ui/upstream";
export interface PostListProps {
  canLoadMore: boolean;
  canVote: boolean;
  loadingMore: boolean;
  posts: PortalPostSummary[];
  workspaceId: string;
  votePostId?: string | null;
  voteProblem?: PortalProblem | null;
  onLoadMore: () => void;
  onRetryVote?: () => void;
  onVote: (post: PortalPostSummary, voted: boolean) => Promise<void>;
}
export function PostList(props: PostListProps) {
  const { t } = useTranslation("quills");
  return (
    <section aria-labelledby="board-posts">
      <h2 id="board-posts">{t("feedback.recentPosts")}</h2>
      {props.posts.length ? (
        <ul>
          {props.posts.map((post) => (
            <li key={post.id}>
              <a href={portalHref(props.workspaceId, `posts/${post.id}`)}>
                {post.title}
              </a>
              <p>{post.content}</p>
              <PostVoteButton
                voted={post.voted}
                voteCount={post.voteCount}
                disabled={!props.canVote}
                loading={props.votePostId === post.id}
                problem={
                  props.votePostId === post.id ? props.voteProblem : null
                }
                onRetry={props.onRetryVote}
                onVote={(voted) => props.onVote(post, voted)}
              />
              <span>
                {t("feedback.comments", { count: post.commentCount })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("feedback.noPosts")}</p>
      )}
      {props.canLoadMore ? (
        <Button
          type="button"
          loading={props.loadingMore}
          onClick={props.onLoadMore}
        >
          {t("feedback.loadMore")}
        </Button>
      ) : null}
    </section>
  );
}
