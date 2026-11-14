import { useTranslation } from "react-i18next";
import { ConversationRow } from "../../../ui/inbox/conversation-row";
import { ListPane } from "../../../ui/inbox/list-pane";
import {
  conversationHref,
  peopleById,
  rowData,
  statusKeys,
  viewTitleKeys,
  type Conversation,
  type ListContext,
  type Teammate,
} from "../../team-conversations/conversation-list";

export interface ConversationListPaneProps {
  workspaceId: string;
  /** The list that the open conversation came from. */
  context: ListContext;
  items: readonly Conversation[];
  people: readonly Teammate[];
  activeId: string;
  onOpen: (id: string) => void;
  loading: boolean;
}

/**
 * The list pane beside an open conversation: the rows of the list it came from. The main
 * pane shows a failure, so the list pane shows none.
 */
export function ConversationListPane(props: ConversationListPaneProps) {
  const { t } = useTranslation("quills");
  const people = peopleById(props.people);
  const labels = {
    unknown: t("team-conversations.unknown"),
    closed: t(statusKeys.closed),
  };
  return (
    <ListPane
      title={t(viewTitleKeys[props.context.view])}
      headingLevel={2}
      loading={props.loading}
    >
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
    </ListPane>
  );
}
