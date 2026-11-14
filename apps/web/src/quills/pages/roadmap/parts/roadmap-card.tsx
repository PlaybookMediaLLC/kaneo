import { IconMsgsOutline18 } from "nucleo-ui-essential-outline-18";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../../core/portal-href";
import type { PortalProblem } from "../../../core/types";
import { PostVoteButton } from "../../../ui/post/post-vote-button";

export interface RoadmapCardProps {
  post: {
    id: string;
    title: string;
    voteCount: number;
    commentCount: number;
    eta: string | null;
    board: { name: string };
  };
  workspaceId: string;
  voted: boolean;
  canVote: boolean;
  voting: boolean;
  voteProblem: PortalProblem | null;
  onRetryVote: () => void;
  onVote: (voted: boolean) => Promise<void>;
}

export function RoadmapCard({ post, workspaceId, ...props }: RoadmapCardProps) {
  const { t, i18n } = useTranslation("quills");
  return (
    <article className="portal-roadmap-card relative rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:bg-muted/40">
      <p className="text-xs text-muted-foreground">{post.board.name}</p>
      <h3 className="mt-1 text-sm font-medium leading-snug tracking-tight">
        <a
          className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
          href={portalHref(workspaceId, `posts/${post.id}`)}
        >
          {post.title}
        </a>
      </h3>
      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
        <PostVoteButton
          voted={props.voted}
          voteCount={post.voteCount}
          disabled={!props.canVote}
          loading={props.voting}
          problem={props.voteProblem}
          onRetry={props.onRetryVote}
          onVote={props.onVote}
        />
        {post.commentCount ? (
          <span className="flex items-center gap-1">
            <IconMsgsOutline18 aria-hidden="true" className="size-3.5" />
            <span aria-hidden="true">{post.commentCount}</span>
            <span className="sr-only">
              {t("feedback.comments", { count: post.commentCount })}
            </span>
          </span>
        ) : null}
        {post.eta ? (
          <time className="ml-auto" dateTime={post.eta}>
            {new Intl.DateTimeFormat(i18n.language, {
              timeZone: "UTC",
              month: "short",
              year: "numeric",
            }).format(new Date(post.eta))}
          </time>
        ) : null}
      </div>
    </article>
  );
}
