import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchPatch } from "../../core/use-search-patch";
import { useListConversationViews } from "../../hooks/team/use-list-conversation-views";
import { useListConversations } from "../../hooks/team/use-list-conversations";
import { useListPrincipals } from "../../hooks/team/use-list-principals";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { GroupedList } from "../../ui/inbox/grouped-list";
import { ListHeader } from "../../ui/inbox/list-header";
import { ConversationRow } from "../../ui/inbox/conversation-row";
import { StatusTabs } from "../../ui/inbox/status-tabs";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import {
  conversationHref,
  listQuery,
  listStatuses,
  peopleById,
  priorityGroups,
  readContext,
  rowData,
  statusKeys,
  viewTitleKeys,
  type ListContext,
} from "./conversation-list";

export interface TeamConversationsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const SAVED = "saved:";

/** The support inbox: My conversations, Unassigned or All, by status tab or pinned view, grouped by priority. */
export function TeamConversationsPage(props: TeamConversationsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const remember = useSearchPatch();
  const [context, setContext] = useState<ListContext>(() =>
    readContext(props.search, props.params.view),
  );
  const [active, setActive] = useState<string | null>(null);
  const param = { workspaceId: props.workspaceId };
  const views = useListConversationViews({ param }, team.viewer);
  const pinned = views.data?.items.filter((view) => view.isPinned) ?? [];
  const saved = pinned.find((view) => view.id === context.savedView);
  // A pinned view in the address waits for its rules, so the list loads once.
  const waiting = Boolean(context.savedView) && views.isLoading;
  const list = useListConversations(
    {
      param: { workspaceId: waiting ? "" : props.workspaceId },
      query: listQuery(context, saved),
    },
    team.viewer,
  );
  const principals = useListPrincipals(
    { param, query: { limit: "100" } },
    team.viewer,
  );
  const people = peopleById(principals.data?.items);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const open = (id: string) =>
    void navigate({ href: conversationHref(props.workspaceId, id, context) });
  useListNavigation({
    ids: items.map((item) => item.id),
    activeId: active,
    onMove: setActive,
    onOpen: open,
  });
  const choose = (value: string) => {
    const next: ListContext = value.startsWith(SAVED)
      ? { ...context, savedView: value.slice(SAVED.length) }
      : {
          ...context,
          status: readContext({ status: value }).status,
          savedView: undefined,
        };
    setContext(next);
    setActive(null);
    remember({ status: next.status, savedView: next.savedView });
  };
  const title = t(viewTitleKeys[context.view]);
  const labels = {
    unknown: t("team-conversations.unknown"),
    closed: t(statusKeys.closed),
  };

  return (
    <PageFrame
      titleKey={viewTitleKeys[context.view]}
      variant="app"
      landmark={false}
    >
      <ListHeader title={title} />
      {context.view === "queue" ? null : (
        <StatusTabs
          label={t("team-conversations.tabs")}
          tabs={[
            ...listStatuses.map((status) => ({
              value: status,
              label: t(statusKeys[status]),
            })),
            ...pinned.map((view) => ({
              value: `${SAVED}${view.id}`,
              label: view.name,
            })),
          ]}
          value={saved ? `${SAVED}${saved.id}` : context.status}
          onChange={choose}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <TeamStateView
          loading={waiting || list.isLoading}
          problem={list.error ?? null}
          empty={!items.length}
          onRetry={() => void list.refetch()}
        >
          <GroupedList
            label={t("team-conversations.title")}
            groups={priorityGroups(items, t)}
            getKey={(item) => item.id}
            renderItem={(item) => (
              <ConversationRow
                href={conversationHref(props.workspaceId, item.id, context)}
                onOpen={() => open(item.id)}
                selected={item.id === active}
                {...rowData(item, people, labels)}
              />
            )}
          />
          {list.hasNextPage ? (
            <div className="p-4">
              <Button
                variant="outline"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {t("team-conversations.loadMore")}
              </Button>
            </div>
          ) : null}
        </TeamStateView>
      </div>
    </PageFrame>
  );
}
