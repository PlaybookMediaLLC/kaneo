import { Inbox, Layers, SquarePen } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchPatch } from "../../../core/use-search-patch";
import type { useListTickets } from "../../../hooks/team/use-list-tickets";
import { useTeamRuntime } from "../../../team/runtime";
import { ConversationRow } from "../../../ui/inbox/conversation-row";
import { GroupedList, type ListGroup } from "../../../ui/inbox/grouped-list";
import { ListPane } from "../../../ui/inbox/list-pane";
import { PostStatusIcon } from "../../../ui/inbox/post-status-icon";
import {
  Button,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../ui/upstream";
import {
  statusFill,
  ticketHref,
  ticketRow,
  type Ticket,
  type TicketScope,
  type TicketStatus,
} from "../ticket-scope";

export interface TicketListPaneProps {
  scope: TicketScope;
  /** 2 while the open ticket or the new ticket form has the h1. */
  headingLevel: 1 | 2;
  statuses: readonly TicketStatus[];
  /** The rows in priority groups, as the page navigates them. */
  groups: readonly ListGroup<Ticket>[];
  list: ReturnType<typeof useListTickets>;
  /** The open ticket or the keyboard highlight. */
  activeId: string | null;
  onOpen: (ticketId: string) => void;
  /** Opens the new ticket form. Absent without the create permission. */
  onNew?: () => void;
}

/** The list pane of the tickets: the title, the status filter menu, New ticket, search and the rows. */
export function TicketListPane(props: TicketListPaneProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const patch = useSearchPatch();
  const { scope, list } = props;
  const title = t(scope.mine ? "team-tickets.mine" : "team-tickets.title");
  const newLabel = t("team-tickets.new.title");
  const filter = (value: string, label: string, icon: ReactNode) => (
    <MenuRadioItem key={value} value={value}>
      {icon}
      {label}
    </MenuRadioItem>
  );
  return (
    <ListPane
      title={title}
      headingLevel={props.headingLevel}
      actions={
        props.onNew ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={newLabel}
                  onClick={props.onNew}
                />
              }
            >
              <SquarePen aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{newLabel}</TooltipContent>
          </Tooltip>
        ) : null
      }
      filters={
        <MenuRadioGroup
          value={scope.status}
          onValueChange={(value) =>
            patch({ status: value === "open" ? undefined : String(value) })
          }
        >
          {filter("open", t("team-tickets.open"), <Inbox aria-hidden="true" />)}
          {filter("all", t("team-tickets.all"), <Layers aria-hidden="true" />)}
          {props.statuses.length ? <MenuSeparator /> : null}
          {props.statuses.map((status) =>
            filter(
              status.id,
              status.name,
              <PostStatusIcon
                color={status.color}
                progress={statusFill(status.category)}
              />,
            ),
          )}
        </MenuRadioGroup>
      }
      search={{
        label: t("team-tickets.search"),
        value: scope.q,
        onChange: (q) => patch({ q }),
      }}
      loading={list.isLoading}
      problem={list.error ?? null}
      empty={!props.groups.some((group) => group.items.length)}
      onRetry={() => void list.refetch()}
    >
      <GroupedList
        label={title}
        groups={props.groups}
        getKey={(ticket) => ticket.id}
        renderItem={(ticket) => (
          <ConversationRow
            {...ticketRow(ticket, t("team-tickets.noRequester"))}
            href={ticketHref(team.workspaceId, ticket.id, scope)}
            onOpen={() => props.onOpen(ticket.id)}
            selected={ticket.id === props.activeId}
          />
        )}
      />
      {list.hasNextPage ? (
        <div className="p-2">
          <Button
            variant="outline"
            className="w-full"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t("team-tickets.loadMore")}
          </Button>
        </div>
      ) : null}
    </ListPane>
  );
}
