import { useNavigate } from "@tanstack/react-router";
import { Bookmark, BookmarkPlus, SquarePen, Zap } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTeamRuntime } from "../../team/runtime";
import { ListPane } from "../../ui/inbox/list-pane";
import {
  Button,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDebouncedValue,
} from "../../ui/upstream";
import {
  listHref,
  type ListContext,
  type SavedView,
} from "./conversation-list";
import {
  chooseFilter,
  filterValue,
  listFilters,
  listTitle,
  savedValue,
  viewRules,
} from "./list-filters";

export interface ConversationListPaneProps {
  workspaceId: string;
  context: ListContext;
  /** The saved views of the filter menu. */
  views: readonly SavedView[];
  /** 1 on the list page; 2 beside an open conversation, which has the h1. */
  headingLevel: 1 | 2;
  onSearch: (search: string) => void;
  /** Opens the save view dialog. Without it the menu leaves the item out. */
  onSaveView?: () => void;
  /** The rows (ConversationRows) inside the page's TeamStateView. */
  children: ReactNode;
}

const QUEUE: ListContext = { view: "queue", status: "open" };

/**
 * The list pane of both conversation pages (design section 2): the title, the Queue pill,
 * the filter menu, New message, the search field and the rows that the page passes.
 */
export function ConversationListPane(props: ConversationListPaneProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const navigate = useNavigate();
  const go = (href: string) => void navigate({ href });
  const [query, setQuery] = useState(props.context.search ?? "");
  const debounced = useDebouncedValue(query.trim(), 300);
  const sent = useRef(debounced);
  const { onSearch } = props;
  useEffect(() => {
    if (debounced === sent.current) return;
    sent.current = debounced;
    onSearch(debounced);
  }, [debounced, onSearch]);
  const newMessage = t("team-conversations.newMessage.title");
  const filters = (
    <>
      <MenuRadioGroup
        value={filterValue(props.context)}
        onValueChange={(value) => {
          const next = chooseFilter(props.context, String(value));
          if (next) go(listHref(props.workspaceId, next));
        }}
      >
        {listFilters.map(({ id, labelKey, icon: Icon, group }) => (
          <Fragment key={id}>
            {group ? <MenuSeparator /> : null}
            <MenuRadioItem value={id}>
              <span className="flex items-center gap-2">
                <Icon aria-hidden="true" />
                {t(labelKey)}
              </span>
            </MenuRadioItem>
          </Fragment>
        ))}
        {props.views.length ? <MenuSeparator /> : null}
        {props.views.map((view) => (
          <MenuRadioItem key={view.id} value={savedValue(view.id)}>
            <span className="flex items-center gap-2">
              <Bookmark aria-hidden="true" />
              {view.name}
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {props.onSaveView ? (
        <>
          <MenuSeparator />
          <MenuItem
            disabled={!viewRules(props.context)}
            onClick={props.onSaveView}
          >
            <BookmarkPlus aria-hidden="true" />
            {t("team-conversations.saveView.open")}
          </MenuItem>
        </>
      ) : null}
    </>
  );
  return (
    <ListPane
      title={listTitle(props.context, props.views, t)}
      headingLevel={props.headingLevel}
      filters={filters}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() =>
              go(listHref(props.workspaceId, QUEUE, { next: "true" }))
            }
          >
            <Zap aria-hidden="true" />
            {t("team-conversations.views.queue")}
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={newMessage}
                  disabled={!team.permissions.update}
                  onClick={() =>
                    go(
                      listHref(props.workspaceId, props.context, {
                        new: "true",
                      }),
                    )
                  }
                />
              }
            >
              <SquarePen aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{newMessage}</TooltipContent>
          </Tooltip>
        </>
      }
      search={{
        label: t("team-conversations.search"),
        value: query,
        onChange: setQuery,
      }}
    >
      {props.children}
    </ListPane>
  );
}
