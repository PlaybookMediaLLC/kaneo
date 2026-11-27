import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { HelpSuggestions } from "../../portal/help-suggestions";
import { usePortalRuntime } from "../../portal/runtime";
import { SimilarRequests } from "../../portal/similar-requests";
import { BoardFilters } from "../../ui/board-filters";
import { BoardNavigation } from "../../ui/board-navigation";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { PostList } from "../../ui/post/post-list";
import { PostSort } from "../../ui/post/post-sort";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { SurveyPrompt } from "./parts/survey-prompt";

export interface FeedbackHomePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function FeedbackHomePage(props: FeedbackHomePageProps) {
  const navigate = useNavigate();
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const [stage, setStage] = useState(
    typeof props.search.stage === "string" ? props.search.stage : "",
  );
  const [sort, setSort] = useState(
    typeof props.search.sort === "string" ? props.search.sort : "votes",
  );
  const [title, setTitle] = useState("");
  const urlTitle =
    typeof props.search.title === "string" ? props.search.title : undefined;
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
  const remember = useSearchPatch();
  const rail = boards.data && {
    boards: boards.data.items,
    workspaceId: props.workspaceId,
    stages: feedbackStages(statuses.data?.items ?? []),
    stage,
    onStageChange: (value: string) => {
      setStage(value);
      remember({ stage: value });
    },
  };
  // The given title is a one-time start. After the composer has read it, the
  // address drops it, so a reload does not bring back a sent post or undo an edit.
  useEffect(() => {
    if (urlTitle && viewer.kind === "user" && boards.data)
      remember({ title: undefined });
  });
  const submittable =
    boards.data?.items.filter((board) => board.canSubmit) ?? [];

  const canVoteBoard = (id: string) =>
    Boolean(boards.data?.items.some((b) => b.id === id && b.canVote));
  return (
    <PageFrame
      hub
      titleKey="feedback.title"
      mobileAside={false}
      aside={rail ? <BoardNavigation {...rail} stats={stats.data} /> : null}
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId)}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={viewer.kind === "user"}
        >
          <StateView
            loading={boards.isLoading || statuses.isLoading}
            problem={boards.error ?? statuses.error ?? null}
            onRetry={() => {
              void boards.refetch();
              void statuses.refetch();
            }}
          >
            {boards.data && (viewer.kind !== "user" || submittable.length) ? (
              <FeedbackComposer
                workspaceId={props.workspaceId}
                boards={submittable}
                autoFocus={"openFeedback" in props.search}
                initialTitle={urlTitle}
                signInReturn={{
                  path: "",
                  search: { openFeedback: urlTitle && "1", title: urlTitle },
                }}
                onTitleChange={setTitle}
              />
            ) : null}
            <SimilarRequests
              workspaceId={props.workspaceId}
              title={title}
              posts={similar.data?.items ?? []}
              stages={rail?.stages}
              canVote={canVoteBoard}
            />
            <HelpSuggestions workspaceId={props.workspaceId} title={title} />
            <SurveyPrompt workspaceId={workspace} viewer={viewer} />
            <PostSort
              sort={sort}
              filters={rail ? <BoardFilters {...rail} /> : null}
              onSortChange={(value) => {
                setSort(value);
                remember({ sort: value === "votes" ? "" : value });
              }}
            />
            <StateView
              loading={posts.isLoading}
              problem={posts.error ?? null}
              onRetry={() => void posts.refetch()}
              rows={5}
            >
              <PostList
                posts={posts.data?.pages.flatMap((page) => page.items) ?? []}
                workspaceId={props.workspaceId}
                canVote={(post) =>
                  votePostId === null && canVoteBoard(post.board.id)
                }
                canLoadMore={Boolean(posts.hasNextPage)}
                loadingMore={posts.isFetchingNextPage}
                votePostId={votePostId}
                voteProblem={vote.error}
                onLoadMore={() => void posts.fetchNextPage()}
                onNavigate={(href) => void navigate({ href })}
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
