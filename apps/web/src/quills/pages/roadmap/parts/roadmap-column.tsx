import { IconCalendarOutline18 } from "nucleo-ui-essential-outline-18";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Viewer } from "../../../core/types";
import { useListPortalRoadmapPosts } from "../../../hooks/feedback/use-list-portal-roadmap-posts";
import { useSetPortalVote } from "../../../hooks/feedback/use-set-portal-vote";
import { StatusIcon } from "../../../ui/post/status-icon";
import { StateView } from "../../../ui/state-view";
import { Button } from "../../../ui/upstream";
import { RoadmapCard } from "./roadmap-card";

export interface RoadmapColumnProps {
  workspaceId: string;
  viewer: Viewer;
  roadmapId: string;
  label: string;
  statusId?: string;
  bucketId?: string;
  search: string;
  sort: "votes" | "newest" | "oldest";
  /** The column's status; a date column has none. */
  status?: { stage: string | null; color: string | null };
  votedIds?: ReadonlySet<string>;
  canVote?: (boardId: string) => boolean;
}

const descriptions: Record<string, string> = {
  planned: "roadmap.planned",
  in_progress: "roadmap.in_progress",
  shipped: "roadmap.shipped",
};

export function RoadmapColumn(props: RoadmapColumnProps) {
  const { t } = useTranslation("quills");
  const id = useId();
  const [offset, setOffset] = useState(0);
  const [votePostId, setVotePostId] = useState<string | null>(null);
  const vote = useSetPortalVote(props.viewer);
  const posts = useListPortalRoadmapPosts(
    {
      param: { workspace: props.workspaceId, roadmapId: props.roadmapId },
      query: {
        statusId: props.statusId,
        bucketId: props.bucketId,
        search: props.search.trim() || undefined,
        sort: props.sort,
        offset: String(offset),
        limit: "10",
      },
    },
    props.viewer,
  );
  const stage = props.status?.stage;
  const description = stage ? descriptions[stage] : undefined;
  return (
    <section aria-labelledby={id} className="portal-roadmap-column min-w-0">
      <div className="mb-3">
        <h2 id={id} className="flex items-center gap-2 text-sm font-medium">
          {props.status ? (
            <StatusIcon stage={stage ?? null} color={props.status.color} />
          ) : (
            <IconCalendarOutline18
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
          )}
          {props.label}
          {posts.data ? (
            <span className="font-normal text-muted-foreground tabular-nums">
              {posts.data.total}
            </span>
          ) : null}
        </h2>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(description)}
          </p>
        ) : null}
      </div>
      <StateView
        loading={posts.isLoading}
        problem={posts.error}
        onRetry={() => void posts.refetch()}
      >
        {posts.data?.items.length ? (
          <ul className="grid gap-2.5">
            {posts.data.items.map((post) => (
              <li key={post.id}>
                <RoadmapCard
                  post={post}
                  workspaceId={props.workspaceId}
                  voted={
                    vote.data?.postId === post.id
                      ? vote.data.voted
                      : Boolean(props.votedIds?.has(post.id))
                  }
                  canVote={
                    !vote.isPending && Boolean(props.canVote?.(post.board.id))
                  }
                  voting={vote.isPending && votePostId === post.id}
                  // A failed vote stays on its own card; the others can still vote.
                  voteProblem={votePostId === post.id ? vote.error : null}
                  onRetryVote={() => vote.reset()}
                  onVote={async (voted) => {
                    setVotePostId(post.id);
                    await vote.mutateAsync({
                      param: { workspace: props.workspaceId, postId: post.id },
                      json: { voted },
                    });
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            {t("roadmap.empty")}
          </p>
        )}
      </StateView>
      {offset > 0 || posts.data?.hasMore ? (
        <div className="mt-2 flex justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={offset === 0 || posts.isFetching}
            onClick={() => setOffset((value) => Math.max(0, value - 10))}
          >
            {t("feedback.previous")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={!posts.data?.hasMore || posts.isFetching}
            onClick={() => setOffset((value) => value + 10)}
          >
            {t("feedback.next")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
