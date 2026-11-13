import { IconMsgsOutline18 } from "nucleo-ui-essential-outline-18";
import { useTranslation } from "react-i18next";
// quills-web-allow C13: Type-only API DTO import; this component receives all data and callbacks through props.
import type { PortalPostSummary } from "../../api/feedback/portal-post-summary.type";
import { portalHref } from "../../core/portal-href";
import type { PortalProblem } from "../../core/types";
import { PersonAvatar } from "../person-avatar";
import { PostVoteButton } from "./post-vote-button";
import { StatusIcon } from "./status-icon";
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
  if (!props.posts.length)
    return (
      <p className="portal-post-empty rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        {t("feedback.noPosts")}
      </p>
    );
  return (
    <div className="portal-post-feed">
      <ul className="-mx-3" aria-label={t("feedback.posts")}>
        {props.posts.map((post) => (
          <li
            key={post.id}
            className="portal-post-row relative flex items-center gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/60"
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
              problem={props.votePostId === post.id ? props.voteProblem : null}
              onRetry={props.onRetryVote}
              onVote={(voted) => props.onVote(post, voted)}
            />
            <div className="min-w-0 flex-1">
              <a
                className="block truncate font-medium tracking-tight after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                href={portalHref(props.workspaceId, `posts/${post.id}`)}
              >
                {post.title}
              </a>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs text-muted-foreground">
                <span>{post.author.name || t("post.anonymousAuthor")}</span>
                {post.status ? (
                  <span className="inline-flex items-center gap-1.5">
                    <StatusIcon
                      stage={post.stage}
                      color={post.status.color}
                      className="size-3"
                    />
                    {post.status.name}
                  </span>
                ) : null}
                {post.pending ? <span>{t("post.pending")}</span> : null}
              </p>
            </div>
            {post.commentCount ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                <IconMsgsOutline18 aria-hidden="true" className="size-3.5" />
                <span aria-hidden="true">{post.commentCount}</span>
                <span className="sr-only">
                  {t("feedback.comments", { count: post.commentCount })}
                </span>
              </span>
            ) : null}
            <PersonAvatar
              name={post.author.name}
              avatarUrl={post.author.avatarUrl}
              className="hidden size-6 sm:inline-flex"
            />
          </li>
        ))}
      </ul>
      {props.canLoadMore ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-4 w-full text-muted-foreground"
          loading={props.loadingMore}
          onClick={props.onLoadMore}
        >
          {t("feedback.loadMore")}
        </Button>
      ) : (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          {t("feedback.caughtUp")}
        </p>
      )}
    </div>
  );
}
