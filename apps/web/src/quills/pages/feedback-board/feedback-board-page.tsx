import { useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useCreatePortalPost } from "../../hooks/feedback/use-create-portal-post";
import { useListPortalBoards } from "../../hooks/feedback/use-list-portal-boards";
import { useListPortalPosts } from "../../hooks/feedback/use-list-portal-posts";
import { useListPortalStatuses } from "../../hooks/feedback/use-list-portal-statuses";
import { useSetPortalVote } from "../../hooks/feedback/use-set-portal-vote";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../ui/upstream";
import { meta } from "./meta";
import { PostFilters } from "./parts/post-filters";
import { PostList } from "./parts/post-list";
import { SubmitPostForm } from "./parts/submit-post-form";

export interface FeedbackBoardPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function FeedbackBoardPage(props: FeedbackBoardPageProps) {
  const { t } = useTranslation("quills");
  const portal = usePortalRuntime();
  const boardId = props.params.boardId ?? "";
  const [search, setSearch] = useState(
    typeof props.search.search === "string" ? props.search.search : "",
  );
  const [stage, setStage] = useState(
    typeof props.search.stage === "string" ? props.search.stage : "",
  );
  const [sort, setSort] = useState(
    typeof props.search.sort === "string" ? props.search.sort : "newest",
  );
  const [submitting, setSubmitting] = useState(false);
  const [votePostId, setVotePostId] = useState<string | null>(null);
  const canLoad = !portal.accessLoading && portal.access?.granted === true;
  const workspace = canLoad ? props.workspaceId : "";
  const boards = useListPortalBoards(
    { param: { workspace }, query: { counts: "true" } },
    portal.viewer,
  );
  const statuses = useListPortalStatuses(
    { param: { workspace } },
    portal.viewer,
  );
  const posts = useListPortalPosts(
    {
      param: { workspace },
      query: {
        boardId,
        search: search || undefined,
        stage: (stage || undefined) as
          | "open"
          | "planned"
          | "in_progress"
          | "shipped"
          | undefined,
        sort: sort as "newest" | "oldest" | "votes",
        limit: "20",
      },
    },
    portal.viewer,
  );
  const vote = useSetPortalVote(portal.viewer);
  const create = useCreatePortalPost(portal.viewer);
  const board = boards.data?.items.find((item) => item.id === boardId);
  const postItems = posts.data?.pages.flatMap((page) => page.items) ?? [];
  const stageOptions = [
    ...new Map(
      (statuses.data?.items ?? [])
        .filter((item) => item.stage)
        .map((item) => [
          item.stage as string,
          { value: item.stage as string, label: item.name },
        ]),
    ).values(),
  ];

  return (
    <PageFrame titleKey="feedback.title">
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
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={boards.isLoading || statuses.isLoading || posts.isLoading}
            problem={boards.error ?? statuses.error ?? posts.error ?? null}
            onRetry={() => {
              void boards.refetch();
              void statuses.refetch();
              void posts.refetch();
            }}
          >
            {board ? (
              <>
                <a href={portalHref(props.workspaceId)}>
                  {t("feedback.backToBoards")}
                </a>
                <h2>{board.name}</h2>
                {board.description ? <p>{board.description}</p> : null}
                <PostFilters
                  search={search}
                  stage={stage}
                  sort={sort}
                  stages={stageOptions}
                  onSearchChange={setSearch}
                  onStageChange={setStage}
                  onSortChange={setSort}
                />
                <PostList
                  posts={postItems}
                  workspaceId={props.workspaceId}
                  canVote={board.canVote}
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
                {portal.viewer.kind === "user" && board.canSubmit ? (
                  <Button type="button" onClick={() => setSubmitting(true)}>
                    {t("feedback.submit")}
                  </Button>
                ) : portal.viewer.kind !== "user" ? (
                  <p>
                    {t("feedback.signInToSubmit")}{" "}
                    <a
                      href={`/auth/sign-in?redirect=${encodeURIComponent(portalHref(props.workspaceId, `boards/${boardId}`))}`}
                    >
                      {t("feedback.signIn")}
                    </a>
                  </p>
                ) : null}
                <Sheet open={submitting} onOpenChange={setSubmitting}>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>{t("feedback.submitTitle")}</SheetTitle>
                    </SheetHeader>
                    <SubmitPostForm
                      workspaceId={props.workspaceId}
                      viewer={portal.viewer}
                      boards={[board]}
                      defaultBoardId={board.id}
                      onSubmit={async (values) => {
                        try {
                          await create.mutateAsync({
                            param: { workspace: props.workspaceId },
                            json: values,
                          });
                          setSubmitting(false);
                        } catch (problem) {
                          return problem as never;
                        }
                      }}
                    />
                  </SheetContent>
                </Sheet>
              </>
            ) : boards.data ? (
              <StateView problem={{ kind: "notFound" }}>{null}</StateView>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
