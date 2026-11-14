import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListTicketStatuses } from "../../hooks/team/use-list-ticket-statuses";
import { useListTickets } from "../../hooks/team/use-list-tickets";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { GroupedList } from "../../ui/inbox/grouped-list";
import { ListHeader } from "../../ui/inbox/list-header";
import { ListRow } from "../../ui/inbox/list-row";
import { StatusTabs } from "../../ui/inbox/status-tabs";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { Button } from "../../ui/upstream";
import {
  priorityGroups,
  ticketHref,
  ticketQuery,
  ticketRow,
  ticketScope,
} from "./ticket-scope";

export interface TeamTicketsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** The ticket inbox: status tabs from the workspace ticket statuses, rows in priority groups. */
export function TeamTicketsPage({ workspaceId, search }: TeamTicketsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const scope = ticketScope(search);
  const list = useListTickets(
    { param: { workspaceId }, query: ticketQuery(scope) },
    team.viewer,
  );
  const statuses = useListTicketStatuses(
    { param: { workspaceId } },
    team.viewer,
  );
  const [active, setActive] = useState<string | null>(null);
  const groups = priorityGroups(
    list.data?.pages.flatMap((page) => page.items) ?? [],
    (key) => t(key),
  );
  const ids = groups.flatMap((group) => group.items.map((item) => item.id));
  const open = (id: string) =>
    void navigate({ href: ticketHref(workspaceId, id, scope) });
  useListNavigation({ ids, activeId: active, onMove: setActive, onOpen: open });
  const title = t(scope.mine ? "team-tickets.mine" : "team-tickets.title");
  const tabs = [
    { value: "open", label: t("team-tickets.open") },
    ...(statuses.data?.items ?? []).map((status) => ({
      value: status.id,
      label: status.name,
    })),
    { value: "all", label: t("team-tickets.all") },
  ];

  return (
    <PageFrame
      titleKey="team-tickets.title"
      displayTitle={title}
      landmark={false}
      variant="app"
    >
      <ListHeader title={title} />
      <StatusTabs
        label={t("team-tickets.statusTabs")}
        tabs={tabs}
        value={scope.status}
        onChange={(status) =>
          void navigate({
            to: ".",
            search: (previous: Record<string, unknown>) => ({
              ...previous,
              status,
            }),
            replace: true,
          })
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto [&>[role=alert]]:m-4 [&>[role=status]]:px-4">
        <TeamStateView
          loading={list.isLoading}
          problem={list.error ?? null}
          empty={!ids.length}
          onRetry={() => void list.refetch()}
        >
          <GroupedList
            label={title}
            groups={groups}
            getKey={(ticket) => ticket.id}
            renderItem={(ticket) => (
              <ListRow
                {...ticketRow(ticket, t("team-tickets.noRequester"))}
                href={ticketHref(workspaceId, ticket.id, scope)}
                onOpen={() => open(ticket.id)}
                selected={ticket.id === active}
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
                {t("team-tickets.loadMore")}
              </Button>
            </div>
          ) : null}
        </TeamStateView>
      </div>
    </PageFrame>
  );
}
