import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RoadmapStage } from "../../../core/roadmap-stages";
import type { Viewer } from "../../../core/types";
import { useListPortalPosts } from "../../../hooks/feedback/use-list-portal-posts";
import { useSetPortalVote } from "../../../hooks/feedback/use-set-portal-vote";
import { StatusIcon } from "../../../ui/post/status-icon";
import { StateView } from "../../../ui/state-view";
import { Button } from "../../../ui/upstream";
import { RoadmapCard } from "./roadmap-card";

export interface RoadmapColumnProps {
  workspaceId: string;
  viewer: Viewer;
  stage: { value: RoadmapStage; label: string; color: string | null };
  canVote: (boardId: string) => boolean;
}

const descriptions = {
  planned: "roadmap.planned",
  in_progress: "roadmap.in_progress",
  shipped: "roadmap.shipped",
} as const;

export function RoadmapColumn({
  workspaceId,
  viewer,
  stage,
  canVote,
}: RoadmapColumnProps) {
  const { t } = useTranslation("quills");
  const [votePostId, setVotePostId] = useState<string | null>(null);
  const posts = useListPortalPosts(
    {
      param: { workspace: workspaceId },
      query: { stage: stage.value, sort: "votes", limit: "20" },
    },
    viewer,
  );
  const vote = useSetPortalVote(viewer);
  const items = posts.data?.pages.flatMap((page) => page.items) ?? [];
  const id = `roadmap-${stage.value}`;
  return (
    <section aria-labelledby={id} className="portal-roadmap-column min-w-0">
      <div className="mb-3">
        <h2 id={id} className="flex items-center gap-2 text-sm font-medium">
          <StatusIcon stage={stage.value} color={stage.color} />
          {stage.label}
          {posts.data ? (
            <span className="font-normal text-muted-foreground tabular-nums">
              {posts.hasNextPage
                ? t("roadmap.countMore", { count: items.length })
                : items.length}
            </span>
          ) : null}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(descriptions[stage.value])}
        </p>
      </div>
      <StateView
        loading={posts.isLoading}
        problem={posts.error ?? null}
        onRetry={() => void posts.refetch()}
      >
        {items.length ? (
          <ul className="grid gap-2.5">
            {items.map((post) => (
              <li key={post.id}>
                <RoadmapCard
                  post={post}
                  workspaceId={workspaceId}
                  canVote={votePostId === null && canVote(post.board.id)}
                  voting={votePostId === post.id}
                  voteProblem={vote.error}
                  onRetryVote={() => {
                    vote.reset();
                    setVotePostId(null);
                  }}
                  onVote={async (voted) => {
                    setVotePostId(post.id);
                    await vote.mutateAsync({
                      param: { workspace: workspaceId, postId: post.id },
                      json: { voted },
                    });
                    setVotePostId(null);
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
        {posts.hasNextPage ? (
          <Button
            type="button"
            variant="ghost"
            className="mt-2 w-full text-muted-foreground"
            loading={posts.isFetchingNextPage}
            onClick={() => void posts.fetchNextPage()}
          >
            {t("roadmap.loadMore")}
          </Button>
        ) : null}
      </StateView>
    </section>
  );
}
