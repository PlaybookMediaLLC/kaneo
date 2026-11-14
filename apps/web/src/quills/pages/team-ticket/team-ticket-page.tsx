import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useGetTicket } from "../../hooks/team/use-get-ticket";
import { useListTickets } from "../../hooks/team/use-list-tickets";
import { useMarkTicketRead } from "../../hooks/team/use-mark-ticket-read";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { ListRow } from "../../ui/inbox/list-row";
import { PageFrame } from "../../ui/page-frame";
import {
  priorityGroups,
  ticketHref,
  ticketListHref,
  ticketQuery,
  ticketRow,
  ticketScope,
} from "../team-tickets/ticket-scope";
import { TicketPickers } from "./parts/ticket-pickers";
import { TicketProperties } from "./parts/ticket-properties";
import { TicketThread } from "./parts/ticket-thread";

export interface TeamTicketPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/** One ticket in three panes: the list it opens from, the thread, and its properties. */
export function TeamTicketPage({
  workspaceId,
  params,
  search,
}: TeamTicketPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const ticketId = params.ticketId ?? "";
  const scope = ticketScope(search);
  const ticket = useGetTicket(
    { param: { workspaceId, ticketId } },
    team.viewer,
  );
  const list = useListTickets(
    { param: { workspaceId }, query: ticketQuery(scope) },
    team.viewer,
  );
  const { mutate: markRead } = useMarkTicketRead(team.viewer);
  useEffect(() => {
    if (workspaceId && ticketId) markRead({ param: { workspaceId, ticketId } });
  }, [markRead, workspaceId, ticketId]);
  const items = priorityGroups(
    list.data?.pages.flatMap((page) => page.items) ?? [],
    (key) => t(key),
  ).flatMap((group) => group.items);
  const go = (href: string) => void navigate({ href });
  const open = (id: string) => go(ticketHref(workspaceId, id, scope));

  return (
    <PageFrame
      titleKey="team-tickets.ticket"
      displayTitle={ticket.data?.title}
      landmark={false}
      variant="app"
    >
      <DetailLayout
        list={
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <ListRow
                  {...ticketRow(item, t("team-tickets.noRequester"))}
                  href={ticketHref(workspaceId, item.id, scope)}
                  onOpen={() => open(item.id)}
                  selected={item.id === ticketId}
                  compact
                />
              </li>
            ))}
          </ul>
        }
        listLabel={t(scope.mine ? "team-tickets.mine" : "team-tickets.title")}
        ids={items.map((item) => item.id)}
        activeId={ticketId}
        onMove={open}
        onBack={() => go(ticketListHref(workspaceId, scope))}
        properties={
          ticket.data ? <TicketProperties ticket={ticket.data} /> : null
        }
        propertiesLabel={t("team-tickets.properties")}
      >
        <header className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {ticket.data?.reference}
          </p>
          <h1
            tabIndex={-1}
            className="text-lg font-semibold leading-tight outline-none"
          >
            {ticket.data?.title ?? t("team-tickets.ticket")}
          </h1>
          {ticket.data ? <TicketPickers ticket={ticket.data} /> : null}
        </header>
        <div className="flex flex-1 flex-col [&>[role=alert]]:m-4 [&>[role=status]]:px-4">
          <TeamStateView
            loading={ticket.isLoading}
            problem={ticket.error ?? null}
            onRetry={() => void ticket.refetch()}
          >
            {ticket.data ? <TicketThread ticket={ticket.data} /> : null}
          </TeamStateView>
        </div>
      </DetailLayout>
    </PageFrame>
  );
}
