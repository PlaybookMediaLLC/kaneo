import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useGetTicket } from "../../hooks/team/use-get-ticket";
import { useListTickets } from "../../hooks/team/use-list-tickets";
import { useMarkTicketRead } from "../../hooks/team/use-mark-ticket-read";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { ConversationRow } from "../../ui/inbox/conversation-row";
import { DetailHeader } from "../../ui/inbox/detail-header";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { ListPane } from "../../ui/inbox/list-pane";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
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
  const back = () => go(ticketListHref(workspaceId, scope));
  const nav = useListNavigation({
    ids: items.map((item) => item.id),
    activeId: ticketId,
    onMove: open,
    onBack: back,
  });
  const title = t(scope.mine ? "team-tickets.mine" : "team-tickets.title");

  return (
    <PageFrame
      titleKey="team-tickets.ticket"
      displayTitle={ticket.data?.title}
      landmark={false}
      variant="app"
    >
      <DetailLayout
        list={
          <ListPane title={title} headingLevel={2} loading={list.isLoading}>
            <ul className="grid gap-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <ConversationRow
                    {...ticketRow(item, t("team-tickets.noRequester"))}
                    href={ticketHref(workspaceId, item.id, scope)}
                    onOpen={() => open(item.id)}
                    selected={item.id === ticketId}
                  />
                </li>
              ))}
            </ul>
          </ListPane>
        }
        listLabel={title}
        properties={
          ticket.data ? <TicketProperties ticket={ticket.data} /> : null
        }
        propertiesLabel={t("team-tickets.properties")}
      >
        <DetailHeader onBack={back} onPrevious={nav.previous} onNext={nav.next}>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {ticket.data?.reference}
            </p>
            <h1
              tabIndex={-1}
              className="truncate text-lg font-semibold leading-tight outline-none"
            >
              {ticket.data?.title ?? t("team-tickets.ticket")}
            </h1>
          </div>
        </DetailHeader>
        {ticket.data ? (
          <div className="border-b border-border px-4 py-2">
            <TicketPickers ticket={ticket.data} />
          </div>
        ) : null}
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
