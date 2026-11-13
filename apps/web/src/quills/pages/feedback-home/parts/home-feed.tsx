import { feedbackStages } from "../../../core/feedback-stages";
import { useState } from "react";
import type { PortalBoard } from "../../../api/feedback/portal-board.type";
import { useListPortalPosts } from "../../../hooks/feedback/use-list-portal-posts";
import { useListPortalStatuses } from "../../../hooks/feedback/use-list-portal-statuses";
import { useSetPortalVote } from "../../../hooks/feedback/use-set-portal-vote";
import type { Viewer } from "../../../core/types";
import { PostFilters } from "../../../ui/post/post-filters";
import { PostList } from "../../../ui/post/post-list";
import { StateView } from "../../../ui/state-view";

export interface HomeFeedProps {
  workspaceId: string;
  viewer: Viewer;
  boards: PortalBoard[];
}

export function HomeFeed({ workspaceId, boards, viewer }: HomeFeedProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [stage, setStage] = useState("");
  const [votePostId, setVotePostId] = useState<string | null>(null);
  const statuses = useListPortalStatuses(
    { param: { workspace: workspaceId } },
    viewer,
  );
  const posts = useListPortalPosts(
    {
      param: { workspace: workspaceId },
      query: {
        search: search || undefined,
        stage: (stage || undefined) as
          | "open"
          | "planned"
          | "in_progress"
          | "shipped"
          | undefined,
        sort: sort as "newest" | "oldest" | "votes",
        limit: "10",
      },
    },
    viewer,
  );
  const vote = useSetPortalVote(viewer);
  const stages = feedbackStages(statuses.data?.items ?? []);
  return (
    <div className="space-y-5">
      <PostFilters
        search={search}
        sort={sort}
        stage={stage}
        stages={stages}
        onSearchChange={setSearch}
        onSortChange={setSort}
        onStageChange={setStage}
      />
      <StateView
        loading={posts.isLoading || statuses.isLoading}
        problem={posts.error ?? statuses.error ?? null}
        onRetry={() => {
          void posts.refetch();
          void statuses.refetch();
        }}
      >
        <PostList
          posts={posts.data?.pages.flatMap((page) => page.items) ?? []}
          workspaceId={workspaceId}
          canVote={(post) =>
            votePostId === null &&
            boards.some((board) => board.id === post.board.id && board.canVote)
          }
          canLoadMore={Boolean(posts.hasNextPage)}
          loadingMore={posts.isFetchingNextPage}
          votePostId={votePostId}
          voteProblem={vote.error}
          onLoadMore={() => void posts.fetchNextPage()}
          onRetryVote={() => {
            vote.reset();
            setVotePostId(null);
          }}
          onVote={async (post, voted) => {
            setVotePostId(post.id);
            await vote.mutateAsync({
              param: { workspace: workspaceId, postId: post.id },
              json: { voted },
            });
            setVotePostId(null);
          }}
        />
      </StateView>
    </div>
  );
}
