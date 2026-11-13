import { useTranslation } from "react-i18next";
// quills-web-allow C13: Type-only API DTO import; this component receives all data and callbacks through props.
import type { PortalPostSummary } from "../../api/feedback/portal-post-summary.type";
import { portalHref } from "../../core/portal-href";
import type { PortalProblem } from "../../core/types";
import { PostVoteButton } from "../post/post-vote-button";
import { Button } from "../upstream";
export interface PostListProps {
  canLoadMore: boolean;
  canVote: boolean | ((post: PortalPostSummary) => boolean);
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
    <section
      className="portal-post-feed [&>h2]:mb-3 [&>h2]:text-xs [&>h2]:font-normal [&>h2]:text-muted-foreground [&>ul]:divide-y [&>ul]:divide-border [&>p]:rounded-xl [&>p]:border [&>p]:border-dashed [&>p]:border-border [&>p]:p-8 [&>p]:text-center [&>p]:text-muted-foreground"
      aria-labelledby="board-posts"
    >
      <h2 id="board-posts">{t("feedback.recentPosts")}</h2>
      {props.posts.length ? (
        <ul>
          {props.posts.map((post) => (
            <li
              key={post.id}
              className="portal-post-row grid grid-cols-[70px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 py-5 sm:grid-cols-[76px_minmax(0,1fr)_auto]"
            >
              <PostVoteButton
                voted={post.voted}
                voteCount={post.voteCount}
                disabled={
                  !(typeof props.canVote === "function"
                    ? props.canVote(post)
                    : props.canVote)
                }
                loading={props.votePostId === post.id}
                problem={
                  props.votePostId === post.id ? props.voteProblem : null
                }
                onRetry={props.onRetryVote}
                onVote={(voted) => props.onVote(post, voted)}
              />
              <div className="portal-post-copy min-w-0 [&>a]:text-base [&>a]:font-medium [&>a]:tracking-tight [&>a:hover]:text-primary [&>p]:mt-1 [&>p]:line-clamp-2 [&>p]:text-sm [&>p]:text-muted-foreground">
                <a
                  className="block"
                  href={portalHref(props.workspaceId, `posts/${post.id}`)}
                >
                  {post.title}
                </a>
                <p>{post.content}</p>
                <div className="portal-post-meta mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{post.author.name || t("post.anonymousAuthor")}</span>
                  <span>{post.board.name}</span>
                  {post.status ? (
                    <span className="portal-post-status inline-flex items-center gap-1.5 before:size-1.5 before:rounded-full before:bg-primary">
                      {post.status.name}
                    </span>
                  ) : null}
                </div>
              </div>
              <span className="portal-comment-count col-start-2 whitespace-nowrap text-xs text-muted-foreground sm:col-start-auto sm:pt-1">
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
