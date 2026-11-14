import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Plus, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListBoards } from "../../hooks/team/use-list-boards";
import { useListPosts } from "../../hooks/team/use-list-posts";
import { useListStatuses } from "../../hooks/team/use-list-statuses";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
import { TeamStateView } from "../../team/team-state-view";
import { GroupedList } from "../../ui/inbox/grouped-list";
import { ListHeader } from "../../ui/inbox/list-header";
import { PostStatusIcon } from "../../ui/inbox/post-status-icon";
import { RequestFilters } from "../../ui/inbox/request-filters";
import { RequestRow } from "../../ui/inbox/request-row";
import { SearchField } from "../../ui/inbox/search-field";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import { NewRequestDialog } from "./parts/new-request-dialog";
import { groupPosts, postRow, statusIcon } from "./post-list";
import {
  filterPatch,
  postListInput,
  postSearch,
  type PostSearch,
} from "./post-search";
import { useRequestQuery } from "./use-request-query";

export interface TeamPostsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const titles = {
  active: "team-posts.title",
  complete: "team-posts.complete",
  closed: "team-posts.closed",
  all: "team.nav.allRequests",
} as const;

/** The Requests list: the posts of the visible boards by status, with filters, search and keyboard moves. */
export function TeamPostsPage({
  workspaceId,
  search: raw,
}: TeamPostsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const router = useRouter();
  const { new: creating, ...search } = postSearch.parse(raw);
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
  const context = {
    statuses: statuses.data?.statuses ?? [],
    boardName: new Map(
      boards.data?.items.map((board) => [board.id, board.name]),
    ),
    anonymous: t("team-posts.anonymous"),
    stale: (months: number) => t("team-posts.stale", { months }),
  };
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
  const [query, setQuery] = useRequestQuery(search.q, (q) => setSearch({ q }));
  useListNavigation({ ids, activeId: active, onMove: setActive, onOpen: open });
  const tab = search.status ?? "active";

  return (
    <PageFrame titleKey="team-posts.title" landmark={false} variant="app">
      <ListHeader
        title={
          statuses.data?.statuses.find((s) => s.id === search.statusId)?.name ??
          t(titles[tab])
        }
        filters={
          <RequestFilters
            status={search.statusId ? "" : tab}
            board={search.board ?? ""}
            sort={search.sort ?? "newest"}
            boards={boards.data?.items ?? []}
            onChange={(key, value) => setSearch(filterPatch(key, value))}
          />
        }
        actions={
          <>
            <SearchField
              label={t("team-posts.search")}
              value={query}
              onChange={setQuery}
              className="w-44 sm:w-56"
            />
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              render={<Link to={teamHref(workspaceId, "/triage")} />}
            >
              <Zap aria-hidden="true" />
              {t("team-posts.triage")}
            </Button>
            {team.permissions.create ? (
              <Button size="sm" onClick={() => setSearch({ new: true })}>
                <Plus aria-hidden="true" />
                {t("team-posts.newRequest")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <TeamStateView
          loading={
            statuses.isLoading ||
            boards.isLoading ||
            (Boolean(statuses.data) && !list.none && posts.isPending)
          }
          problem={statuses.error ?? boards.error ?? posts.error}
          empty={!ids.length}
          onRetry={() => {
            void statuses.refetch();
            void boards.refetch();
            void posts.refetch();
          }}
        >
          <GroupedList
            label={t("team-posts.list")}
            groups={groups}
            getKey={(post) => post.id}
            renderItem={(post) => (
              <RequestRow
                {...postRow(post, context)}
                icon={
                  <PostStatusIcon {...statusIcon(post, context.statuses)} />
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
      {creating && team.permissions.create && statuses.data && boards.data ? (
        <NewRequestDialog
          workspaceId={workspaceId}
          boards={boards.data.items}
          statuses={statuses.data.statuses}
          boardId={search.board}
          onClose={() => setSearch({ new: undefined })}
          onCreated={open}
        />
      ) : null}
    </PageFrame>
  );
}
