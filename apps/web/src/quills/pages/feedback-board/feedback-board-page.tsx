import { useState } from "react";
import { feedbackStages, type FeedbackStage } from "../../core/feedback-stages";
import { portalHref } from "../../core/portal-href";
import { useSearchPatch } from "../../core/use-search-patch";
import { useFindPortalSimilarPosts } from "../../hooks/feedback/use-find-portal-similar-posts";
import { useGetPortalUserStats } from "../../hooks/feedback/use-get-portal-user-stats";
import { useListPortalBoards } from "../../hooks/feedback/use-list-portal-boards";
import { useListPortalPosts } from "../../hooks/feedback/use-list-portal-posts";
import { useListPortalStatuses } from "../../hooks/feedback/use-list-portal-statuses";
import { useSetPortalVote } from "../../hooks/feedback/use-set-portal-vote";
import { FeedbackComposer } from "../../portal/feedback-composer";
import { usePortalRuntime } from "../../portal/runtime";
import { SimilarRequests } from "../../portal/similar-requests";
import { BoardNavigation } from "../../ui/board-navigation";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { PostList } from "../../ui/post/post-list";
import { PostSort } from "../../ui/post/post-sort";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
export interface FeedbackBoardPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function FeedbackBoardPage(props: FeedbackBoardPageProps) {
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const boardId = props.params.boardId ?? "";
  const search =
    typeof props.search.search === "string" ? props.search.search : undefined;
  const [stage, setStage] = useState(
    typeof props.search.stage === "string" ? props.search.stage : "",
  );
  const [sort, setSort] = useState(
    typeof props.search.sort === "string" ? props.search.sort : "votes",
  );
  const [title, setTitle] = useState("");
  const [votePostId, setVotePostId] = useState<string | null>(null);
  const canLoad = !portal.accessLoading && portal.access?.granted === true;
  const workspace = canLoad ? props.workspaceId : "";
  const boards = useListPortalBoards(
    { param: { workspace }, query: { counts: "true" } },
    viewer,
  );
  const statuses = useListPortalStatuses({ param: { workspace } }, viewer);
  const stats = useGetPortalUserStats(
    { param: { workspace: viewer.kind === "user" ? workspace : "" } },
    viewer,
  );
  const posts = useListPortalPosts(
    {
      param: { workspace },
      query: {
        boardId,
        search,
        stage: (stage || undefined) as FeedbackStage | undefined,
        sort: sort as "newest" | "oldest" | "votes",
        limit: "20",
      },
    },
    viewer,
  );
  const similar = useFindPortalSimilarPosts(
    {
      param: { workspace: title.trim().length >= 3 ? workspace : "" },
      query: { title: title.trim(), limit: "5" },
    },
    viewer,
  );
  const vote = useSetPortalVote(viewer);
  const board = boards.data?.items.find((item) => item.id === boardId);
  const remember = useSearchPatch();
  return (
    <PageFrame
      titleKey="feedback.title"
      displayTitle={canLoad ? board?.name : undefined}
      description={board?.description || undefined}
      aside={
        boards.data ? (
          <BoardNavigation
            boards={boards.data.items}
            workspaceId={props.workspaceId}
            boardId={boardId}
            stages={feedbackStages(statuses.data?.items ?? [])}
            stage={stage}
            stats={stats.data}
            onStageChange={(value) => {
              setStage(value);
              remember({ stage: value });
            }}
          />
        ) : null
      }
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, `boards/${boardId}`)}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={viewer.kind === "user"}
        >
          <StateView
            loading={boards.isLoading || statuses.isLoading}
            problem={
              boards.error ??
              statuses.error ??
              (boards.data && !board ? { kind: "notFound" } : null)
            }
            onRetry={() => {
              void boards.refetch();
              void statuses.refetch();
            }}
          >
            {board && (viewer.kind !== "user" || board.canSubmit) ? (
              <FeedbackComposer
                workspaceId={props.workspaceId}
                boards={[board]}
                defaultBoardId={board.id}
                signInHref={
                  viewer.kind === "user"
                    ? undefined
                    : `/auth/sign-in?redirect=${encodeURIComponent(portalHref(props.workspaceId, `boards/${boardId}`))}`
                }
                onTitleChange={setTitle}
              />
            ) : null}
            <SimilarRequests
              workspaceId={props.workspaceId}
              title={title}
              posts={similar.data?.items ?? []}
              canVote={(id) =>
                Boolean(
                  boards.data?.items.some(
                    (item) => item.id === id && item.canVote,
                  ),
                )
              }
            />
            <PostSort
              sort={sort}
              onSortChange={(value) => {
                setSort(value);
                remember({ sort: value === "votes" ? "" : value });
              }}
            />
            <StateView
              loading={posts.isLoading}
              problem={posts.error ?? null}
              onRetry={() => void posts.refetch()}
            >
              <PostList
                posts={posts.data?.pages.flatMap((page) => page.items) ?? []}
                workspaceId={props.workspaceId}
                canVote={Boolean(board?.canVote) && votePostId === null}
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
                    param: { workspace: props.workspaceId, postId: post.id },
                    json: { voted },
                  });
                  setVotePostId(null);
                }}
              />
            </StateView>
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
