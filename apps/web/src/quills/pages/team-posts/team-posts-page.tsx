import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetPostFilterCounts } from "../../hooks/team/use-get-post-filter-counts";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListPosts } from "../../hooks/team/use-list-posts";
import { useListStatuses } from "../../hooks/team/use-list-statuses";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { GroupedList } from "../../ui/inbox/grouped-list";
import { ListHeader } from "../../ui/inbox/list-header";
import { PostStatusIcon } from "../../ui/inbox/post-status-icon";
import { RequestRow } from "../../ui/inbox/request-row";
import { StatusTabs } from "../../ui/inbox/status-tabs";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import { PostFilters, postFilterIds } from "./parts/post-filters";
import { groupPosts, postRow, statusIcon, tabCounts } from "./post-list";
import {
  postFilterQuery,
  postListInput,
  postSearch,
  type PostSearch,
  type PostTab,
} from "./post-search";

export interface TeamPostsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const tabs = [
  { value: "active", labelKey: "team-posts.open" },
  { value: "complete", labelKey: "team-posts.complete" },
  { value: "closed", labelKey: "team-posts.closed" },
  { value: "all", labelKey: "team-posts.all" },
] as const;

/** The feedback inbox: the posts of the visible boards by status, with filters and keyboard moves. */
export function TeamPostsPage({
  workspaceId,
  search: raw,
}: TeamPostsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const router = useRouter();
  const search = postSearch.parse(raw);
  const [active, setActive] = useState<string | null>(null);
  const param = { workspaceId };
  // ponytail: the first 100 statuses and boards (the API maximum); page them when a workspace has more.
  const statuses = useListStatuses(
    { param, query: { limit: "100" } },
    team.viewer,
  );
  const boards = useListBoards(
    { param, query: { offset: "0", limit: "100" } },
    team.viewer,
  );
  const counts = useGetPostFilterCounts(
    { param, query: postFilterQuery(search) },
    team.viewer,
  );
  const list = postListInput(workspaceId, search, statuses.data?.statuses);
  const posts = useListPosts(list.input, team.viewer);
  const items = list.none
    ? []
    : (posts.data?.pages.flatMap((page) => page.items) ?? []);
  const groups = groupPosts(
    items,
    statuses.data?.statuses ?? [],
    t("team-posts.noStatus"),
  );
  const ids = groups.flatMap((group) => group.items.map((post) => post.id));
  const boardName = new Map(
    boards.data?.items.map((board) => [board.id, board.name]),
  );
  const total =
    statuses.data && counts.data
      ? tabCounts(statuses.data.statuses, counts.data)
      : undefined;
  const to = (postId: string) => teamHref(workspaceId, `/posts/${postId}`);
  const open = (postId: string) => void navigate({ to: to(postId), search });
  const setSearch = (patch: Partial<PostSearch>) =>
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        ...patch,
      }),
      replace: true,
    });
  useListNavigation({ ids, activeId: active, onMove: setActive, onOpen: open });

  return (
    <PageFrame titleKey="team-posts.title" landmark={false} variant="app">
      <ListHeader
        title={
          statuses.data?.statuses.find((s) => s.id === search.statusId)?.name ??
          t("team-posts.title")
        }
        onFilters={() => document.getElementById(postFilterIds.board)?.focus()}
      />
      <StatusTabs
        label={t("team-posts.statusTabs")}
        tabs={tabs.map((tab) => ({
          value: tab.value,
          label: t(tab.labelKey),
          count: total?.[tab.value],
        }))}
        value={search.status ?? "active"}
        onChange={(status) =>
          setSearch({ status: status as PostTab, statusId: undefined })
        }
      />
      <PostFilters
        boards={boards.data?.items ?? []}
        search={search}
        onChange={setSearch}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <TeamStateView
          loading={
            statuses.isLoading ||
            boards.isLoading ||
            (Boolean(statuses.data) && !list.none && posts.isPending)
          }
          problem={
            statuses.error ?? boards.error ?? posts.error ?? counts.error
          }
          empty={!ids.length}
          onRetry={() => {
            void statuses.refetch();
            void boards.refetch();
            void counts.refetch();
            void posts.refetch();
          }}
        >
          <GroupedList
            label={t("team-posts.list")}
            groups={groups}
            getKey={(post) => post.id}
            renderItem={(post) => (
              <RequestRow
                {...postRow(
                  post,
                  boardName.get(post.boardId),
                  t("team-posts.anonymous"),
                )}
                icon={
                  <PostStatusIcon
                    {...statusIcon(post, statuses.data?.statuses ?? [])}
                  />
                }
                href={router.buildLocation({ to: to(post.id), search }).href}
                onOpen={() => open(post.id)}
                selected={post.id === active}
              />
            )}
          />
          {posts.hasNextPage ? (
            <Button
              variant="ghost"
              className="m-2"
              loading={posts.isFetchingNextPage}
              onClick={() => void posts.fetchNextPage()}
            >
              {t("team-posts.loadMore")}
            </Button>
          ) : null}
        </TeamStateView>
      </div>
    </PageFrame>
  );
}
