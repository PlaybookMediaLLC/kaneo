import { useTranslation } from "react-i18next";
import type { PortalPostSummary } from "../../../api/feedback/portal-post-summary.type";
import { portalHref } from "../../../core/portal-href";
import type { PortalProblem } from "../../../core/types";
import { PersonAvatar } from "../../../ui/person-avatar";
import { PostVoteButton } from "../../../ui/post/post-vote-button";

export interface RoadmapCardProps {
  post: PortalPostSummary;
  workspaceId: string;
  canVote: boolean;
  voting: boolean;
  voteProblem: PortalProblem | null;
  onRetryVote: () => void;
  onVote: (voted: boolean) => Promise<void>;
}

export function RoadmapCard({ post, workspaceId, ...props }: RoadmapCardProps) {
  const { t } = useTranslation("quills");
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
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <PersonAvatar
          name={post.author.name}
          avatarUrl={post.author.avatarUrl}
          className="size-4 text-[9px]"
        />
        {post.author.name || t("post.anonymousAuthor")}
      </p>
      <div className="mt-3 flex">
        <PostVoteButton
          voted={post.voted}
          voteCount={post.voteCount}
          disabled={!props.canVote}
          loading={props.voting}
          problem={props.voting ? props.voteProblem : null}
          onRetry={props.onRetryVote}
          onVote={props.onVote}
        />
      </div>
    </article>
  );
}
