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
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { GroupedList } from "../../ui/inbox/grouped-list";
import { ListRow } from "../../ui/inbox/list-row";
import { PageFrame } from "../../ui/page-frame";
import { groupPosts, postRow } from "../team-posts/post-list";
import { postListInput, postSearch } from "../team-posts/post-search";
import { PostComposer } from "./parts/post-composer";
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
  const ids = groups.flatMap((group) => group.items.map((item) => item.id));
  const boardName = new Map(
    boards.data?.items.map((board) => [board.id, board.name]),
  );
  const to = (id: string) => teamHref(workspaceId, `/posts/${id}`);
  const open = (id: string) => void navigate({ to: to(id), search });
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
          <GroupedList
            label={t("team-posts.list")}
            groups={groups}
            getKey={(item) => item.id}
            renderItem={(item) => (
              <ListRow
                {...postRow(item, boardName.get(item.boardId), {
                  votes: t("team-posts.votes", { count: item.voteCount }),
                  anonymous: t("team-posts.anonymous"),
                })}
                compact
                href={router.buildLocation({ to: to(item.id), search }).href}
                onOpen={() => open(item.id)}
                selected={item.id === postId}
              />
            )}
          />
        }
        listLabel={t("team-post.list")}
        ids={ids}
        activeId={postId}
        onMove={open}
        onBack={() =>
          void navigate({ to: teamHref(workspaceId, "/posts"), search })
        }
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
