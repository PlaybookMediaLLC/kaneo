import { useTranslation } from "react-i18next";
import { ConversationRow } from "../../ui/inbox/conversation-row";
import { Button } from "../../ui/upstream";
import {
  conversationHref,
  peopleById,
  rowData,
  type Conversation,
  type ListContext,
  type Teammate,
} from "./conversation-list";

export interface ConversationRowsProps {
  workspaceId: string;
  /** The list that the rows belong to; each row link keeps it. */
  context: ListContext;
  items: readonly Conversation[];
  people: readonly Teammate[];
  /** The open conversation or the keyboard highlight. */
  activeId: string | null;
  onOpen: (id: string) => void;
  /** The next page of the list, when there is one. */
  more?: { loading: boolean; load: () => void };
}

/** The rows of a conversation list and the "Load more" button. */
export function ConversationRows(props: ConversationRowsProps) {
  const { t } = useTranslation("quills");
  const people = peopleById(props.people);
  const labels = {
    unknown: t("team-conversations.unknown"),
    resolved: t("team-conversations.status.closed"),
    spam: t("team-conversations.filters.spam"),
  };
  return (
    <>
      <ul className="grid gap-0.5">
        {props.items.map((item) => (
          <li key={item.id}>
            <ConversationRow
              href={conversationHref(props.workspaceId, item.id, props.context)}
              onOpen={() => props.onOpen(item.id)}
              selected={item.id === props.activeId}
              {...rowData(item, people, labels)}
            />
          </li>
        ))}
      </ul>
      {props.more ? (
        <Button
          variant="ghost"
          className="mt-1 w-full"
          loading={props.more.loading}
          onClick={props.more.load}
        >
          {t("team-conversations.loadMore")}
        </Button>
      ) : null}
    </>
  );
}
