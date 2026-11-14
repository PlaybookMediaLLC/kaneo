import { useNavigate, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../../core/relative-time";
import { useGetPost } from "../../hooks/team/use-get-post";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListPostComments } from "../../hooks/team/use-list-post-comments";
import { useListPosts } from "../../hooks/team/use-list-posts";
import { useListStatuses } from "../../hooks/team/use-list-statuses";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { DetailHeader } from "../../ui/inbox/detail-header";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { groupPosts } from "../team-posts/post-list";
import { postListInput, postSearch } from "../team-posts/post-search";
import { PostComposer } from "./parts/post-composer";
import { PostListPane } from "./parts/post-list-pane";
import { PostProperties } from "./parts/post-properties";
import { PostThread } from "./parts/post-thread";

export interface TeamPostPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** One post in three panes: the inbox list, the post with its thread, and its properties. */
export function TeamPostPage({
  workspaceId,
  params,
  search: raw,
}: TeamPostPageProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const router = useRouter();
  const search = postSearch.parse(raw);
  const postId = params.postId ?? "";
  const param = { workspaceId, postId };
  const post = useGetPost({ param }, team.viewer);
  const comments = useListPostComments(
    { param, query: { offset: "0", limit: "100" } },
    team.viewer,
  );
  // The same requests as the inbox, so the list comes from the cache.
  const statuses = useListStatuses(
    { param: { workspaceId }, query: { limit: "100" } },
    team.viewer,
  );
  const boards = useListBoards(
    { param: { workspaceId }, query: { offset: "0", limit: "100" } },
    team.viewer,
  );
  const list = postListInput(workspaceId, search, statuses.data?.statuses);
  const posts = useListPosts(list.input, team.viewer);
  const groups = groupPosts(
    list.none ? [] : (posts.data?.pages.flatMap((page) => page.items) ?? []),
    statuses.data?.statuses ?? [],
    t("team-posts.noStatus"),
  );
  const items = groups.flatMap((group) => group.items);
  const boardName = new Map(
    boards.data?.items.map((board) => [board.id, board.name]),
  );
  const to = (id: string) => teamHref(workspaceId, `/posts/${id}`);
  const open = (id: string) => void navigate({ to: to(id), search });
  const back = () =>
    void navigate({ to: teamHref(workspaceId, "/posts"), search });
  const nav = useListNavigation({
    ids: items.map((item) => item.id),
    activeId: postId,
    onMove: open,
    onBack: back,
  });
  const loading =
    post.isLoading ||
    comments.isLoading ||
    statuses.isLoading ||
    boards.isLoading ||
    (Boolean(statuses.data) && !list.none && posts.isPending);
  const data = post.data;

  return (
    <PageFrame
      titleKey="team-post.title"
      displayTitle={data?.title}
      landmark={false}
      variant="app"
    >
      <DetailLayout
        list={
          <PostListPane
            posts={items}
            statuses={statuses.data?.statuses ?? []}
            boardName={boardName}
            activeId={postId}
            href={(id) => router.buildLocation({ to: to(id), search }).href}
            onOpen={open}
            loading={
              statuses.isLoading ||
              (Boolean(statuses.data) && !list.none && posts.isPending)
            }
          />
        }
        listLabel={t("team-post.list")}
        propertiesLabel={t("team-post.properties")}
        properties={
          !loading && data && statuses.data && boards.data ? (
            <PostProperties
              workspaceId={workspaceId}
              post={data}
              statuses={statuses.data.statuses}
              boards={boards.data.items}
              onScoreSaved={() => void post.refetch()}
            />
          ) : null
        }
      >
        <DetailHeader
          onBack={back}
          backLabel={data ? boardName.get(data.boardId) : undefined}
          onPrevious={nav.previous}
          onNext={nav.next}
        />
        <header className="border-b border-border px-6 py-4">
          <h1 tabIndex={-1} className="text-lg font-semibold outline-none">
            {data?.title ?? t("team-post.title")}
          </h1>
          {data ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("team-post.byline", {
                author: data.authorName ?? t("team-post.anonymous"),
                board: boardName.get(data.boardId) ?? "",
                time: relativeTime(data.createdAt, i18n.language),
              })}
            </p>
          ) : null}
        </header>
        <div className="flex flex-1 flex-col px-6">
          <TeamStateView
            loading={loading}
            problem={
              post.error ??
              comments.error ??
              statuses.error ??
              boards.error ??
              posts.error
            }
            onRetry={() => {
              void post.refetch();
              void comments.refetch();
              void statuses.refetch();
              void boards.refetch();
              void posts.refetch();
            }}
          >
            {data ? (
              <>
                <PostThread
                  post={data}
                  comments={
                    comments.data?.pages.flatMap((page) => page.items) ?? []
                  }
                  hasMore={comments.hasNextPage}
                  loadingMore={comments.isFetchingNextPage}
                  onLoadMore={() => void comments.fetchNextPage()}
                />
                <PostComposer workspaceId={workspaceId} postId={postId} />
              </>
            ) : null}
          </TeamStateView>
        </div>
      </DetailLayout>
    </PageFrame>
  );
}
