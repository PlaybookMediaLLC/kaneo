import { useNavigate } from "@tanstack/react-router";
import { Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetTicket } from "../../hooks/team/use-get-ticket";
import { useListPrincipals } from "../../hooks/team/use-list-principals";
import { useListTicketStatuses } from "../../hooks/team/use-list-ticket-statuses";
import { useListTickets } from "../../hooks/team/use-list-tickets";
import { useMarkTicketRead } from "../../hooks/team/use-mark-ticket-read";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { DetailLayout } from "../../ui/inbox/detail-layout";
import { EmptySelection } from "../../ui/inbox/empty-selection";
import { useListNavigation } from "../../ui/inbox/use-list-navigation";
import { PageFrame } from "../../ui/page-frame";
import { useDebouncedValue } from "../../ui/upstream";
import { NewTicketPane } from "./parts/new-ticket-pane";
import { TicketHeader } from "./parts/ticket-header";
import { TicketListPane } from "./parts/ticket-list-pane";
import { TicketProperties } from "./parts/ticket-properties";
import { TicketThread } from "./parts/ticket-thread";
import {
  priorityGroups,
  ticketHref,
  ticketListHref,
  ticketQuery,
  ticketScope,
} from "./ticket-scope";

export interface TeamTicketsPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/**
 * The tickets in two panes (design section 4): the list pane and the open ticket, the new
 * ticket form, or an empty main pane. The open ticket also has its properties panel.
 */
export function TeamTicketsPage({
  workspaceId,
  params,
  search,
}: TeamTicketsPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const ticketId = params.ticketId ?? "";
  const creating = search.new === true && !ticketId && team.permissions.create;
  const scope = ticketScope(search);
  const q = useDebouncedValue(scope.q, 300);
  const list = useListTickets(
    { param: { workspaceId }, query: ticketQuery({ ...scope, q }) },
    team.viewer,
  );
  const statuses = useListTicketStatuses(
    { param: { workspaceId } },
    team.viewer,
  );
  const ticket = useGetTicket(
    { param: { workspaceId, ticketId } },
    team.viewer,
  );
  // ponytail: the first 100 teammates (the API page size); add search when a workspace has more.
  const people = useListPrincipals(
    { param: { workspaceId: ticketId ? workspaceId : "" }, query: {} },
    team.viewer,
  );
  const { mutate: markRead } = useMarkTicketRead(team.viewer);
  useEffect(() => {
    if (workspaceId && ticketId) markRead({ param: { workspaceId, ticketId } });
  }, [markRead, workspaceId, ticketId]);

  const groups = priorityGroups(
    list.data?.pages.flatMap((page) => page.items) ?? [],
    (key) => t(key),
  );
  const [highlight, setHighlight] = useState<string | null>(null);
  const go = (href: string) => void navigate({ href });
  const open = (id: string) => go(ticketHref(workspaceId, id, scope));
  const back = () => go(ticketListHref(workspaceId, scope));
  const nav = useListNavigation({
    ids: groups.flatMap((group) => group.items.map((item) => item.id)),
    activeId: ticketId || highlight,
    onMove: ticketId ? open : setHighlight,
    onOpen: ticketId ? undefined : open,
    onBack: ticketId || creating ? back : undefined,
  });
  const title = t(scope.mine ? "team-tickets.mine" : "team-tickets.title");
  const statusItems = statuses.data?.items ?? [];

  return (
    <PageFrame
      titleKey={
        ticketId
          ? "team-tickets.ticket"
          : creating
            ? "team-tickets.new.title"
            : "team-tickets.title"
      }
      displayTitle={
        ticketId ? ticket.data?.title : creating ? undefined : title
      }
      landmark={false}
      variant="app"
    >
      <DetailLayout
        list={
          <TicketListPane
            scope={scope}
            headingLevel={ticketId || creating ? 2 : 1}
            statuses={statusItems}
            groups={groups}
            list={list}
            activeId={ticketId || highlight}
            onOpen={open}
            onNew={
              team.permissions.create
                ? () => go(ticketListHref(workspaceId, scope, true))
                : undefined
            }
          />
        }
        listLabel={title}
        itemOpen={Boolean(ticketId) || creating}
        properties={
          ticket.data ? (
            <TicketProperties
              key={ticketId}
              ticket={ticket.data}
              statuses={statusItems}
            />
          ) : null
        }
        propertiesLabel={t("team-tickets.properties")}
      >
        {creating ? (
          <NewTicketPane onBack={back} onCreated={open} />
        ) : ticketId ? (
          <>
            <TicketHeader
              ticket={ticket.data}
              statuses={statusItems}
              people={people.data?.items ?? []}
              onBack={back}
              onPrevious={nav.previous}
              onNext={nav.next}
            />
            <div className="flex min-h-0 flex-1 flex-col [&>[role=alert]]:m-4 [&>[role=status]]:px-4">
              <TeamStateView
                loading={ticket.isLoading}
                problem={ticket.error ?? null}
                onRetry={() => void ticket.refetch()}
              >
                {ticket.data ? (
                  <TicketThread key={ticketId} ticket={ticket.data} />
                ) : null}
              </TeamStateView>
            </div>
          </>
        ) : (
          <EmptySelection
            icon={Ticket}
            title={t("team-tickets.noSelection.title")}
            text={t("team-tickets.noSelection.text")}
          />
        )}
      </DetailLayout>
    </PageFrame>
  );
}
