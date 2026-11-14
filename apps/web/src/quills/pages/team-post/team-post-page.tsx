import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetPost } from "../../hooks/team/use-get-post";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListPostComments } from "../../hooks/team/use-list-post-comments";
import { useListPosts } from "../../hooks/team/use-list-posts";
import { useListStatuses } from "../../hooks/team/use-list-statuses";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { groupPosts } from "../team-posts/post-list";
import {
  postListInput,
  postSearch,
  type PostSearch,
} from "../team-posts/post-search";
import { CommentBox } from "./parts/comment-box";
import { MergePalette, type MergeMode } from "./parts/merge-palette";
import { PostActionBar } from "./parts/post-action-bar";
import { PostBody } from "./parts/post-body";
import { PostHeader } from "./parts/post-header";
import { PostListPane } from "./parts/post-list-pane";
import { PostProperties } from "./parts/post-properties";
import { PostThread } from "./parts/post-thread";

export interface TeamPostPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** One request: the list pane, the request with its comments and action bar, and its properties. */
export function TeamPostPage({
  workspaceId,
  params,
  search: raw,
}: TeamPostPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const router = useRouter();
  // The New request flag stays on the list page.
  const search = { ...postSearch.parse(raw), new: undefined };
  const [merge, setMerge] = useState<MergeMode | null>(null);
  const postId = params.postId ?? "";
  const param = { workspaceId, postId };
  const post = useGetPost({ param }, team.viewer);
  const comments = useListPostComments(
    { param, query: { offset: "0", limit: "100" } },
    team.viewer,
  );
  // The same requests as the list page, so the list comes from the cache.
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
  const items = groupPosts(
    list.none ? [] : (posts.data?.pages.flatMap((page) => page.items) ?? []),
    statuses.data?.statuses ?? [],
    t("team-posts.noStatus"),
  ).flatMap((group) => group.items);
  const to = (id: string) => teamHref(workspaceId, `/posts/${id}`);
  const open = (id: string) => void navigate({ to: to(id), search });
  const back = () =>
    void navigate({ to: teamHref(workspaceId, "/posts"), search });
  const setSearch = (patch: Partial<PostSearch>) =>
    void navigate({ to: ".", search: { ...search, ...patch }, replace: true });
  const nav = useListNavigation({
    ids: items.map((item) => item.id),
    activeId: postId,
    onMove: open,
    onBack: back,
    enabled: !merge,
  });
  const listLoading =
    statuses.isLoading ||
    (Boolean(statuses.data) && !list.none && posts.isPending);
  const loading =
    post.isLoading || comments.isLoading || boards.isLoading || listLoading;
  const data = post.data;
  const queries = [post, comments, statuses, boards, posts] as const;
  const ready = !loading && data && statuses.data && boards.data;

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
            boards={boards.data?.items ?? []}
            search={search}
            onSearch={setSearch}
            activeId={postId}
            href={(id) => router.buildLocation({ to: to(id), search }).href}
            onOpen={open}
            loading={listLoading}
          />
        }
        listLabel={t("team-post.list")}
        propertiesLabel={t("team-post.properties")}
        properties={
          ready ? (
            <PostProperties
              key={postId}
              workspaceId={workspaceId}
              post={data}
              onScoreSaved={() => void post.refetch()}
            />
          ) : null
        }
      >
        <PostHeader
          workspaceId={workspaceId}
          post={data}
          boardName={
            boards.data?.items.find((board) => board.id === data?.boardId)?.name
          }
          onBack={back}
          onPrevious={nav.previous}
          onNext={nav.next}
          onMerge={setMerge}
          onDeleted={back}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <article className="mx-auto grid w-full max-w-200 grid-cols-1 gap-6 px-6 py-8">
            <h1
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none"
            >
              {data?.title ?? t("team-post.title")}
            </h1>
            <TeamStateView
              loading={loading}
              problem={queries.map((query) => query.error).find(Boolean)}
              onRetry={() => queries.forEach((query) => void query.refetch())}
            >
              {ready ? (
                <>
                  <PostBody
                    workspaceId={workspaceId}
                    post={data}
                    boards={boards.data.items}
                  />
                  <CommentBox key={postId} {...param} />
                  <PostThread
                    workspaceId={workspaceId}
                    post={data}
                    comments={
                      comments.data?.pages.flatMap((page) => page.items) ?? []
                    }
                    hasMore={comments.hasNextPage}
                    loadingMore={comments.isFetchingNextPage}
                    onLoadMore={() => void comments.fetchNextPage()}
                  />
                </>
              ) : null}
            </TeamStateView>
          </article>
          {ready ? (
            <PostActionBar
              workspaceId={workspaceId}
              post={data}
              statuses={statuses.data.statuses}
              onMerge={() => setMerge("into")}
              onPrevious={nav.previous}
              onNext={nav.next}
            />
          ) : null}
        </div>
        {merge && ready ? (
          <MergePalette
            workspaceId={workspaceId}
            post={data}
            statuses={statuses.data.statuses}
            mode={merge}
            onClose={() => setMerge(null)}
          />
        ) : null}
      </DetailLayout>
    </PageFrame>
  );
}
