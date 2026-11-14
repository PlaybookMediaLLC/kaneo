import { PanelLeftClose } from "lucide-react";
import { type ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../core/types";
import { TeamStateView } from "../../team/team-state-view";
import { DetailPaneContext } from "./detail-pane-context";
import { IconButton } from "./icon-button";
import { ListHeader } from "./list-header";
import { SearchField, type SearchFieldProps } from "./search-field";

export interface ListPaneProps {
  /** The view title, such as "Open" or "Requests". */
  title: string;
  /** 1 when the main pane is empty; 2 when an open item has the h1. */
  headingLevel?: 1 | 2;
  /** Header controls before the pane toggle, such as a Queue pill or a New message button. */
  actions?: ReactNode;
  /** The filter menu items. The filter button and F open it. */
  filters?: ReactNode;
  /** The search field under the header; "/" focuses it. */
  search?: Pick<SearchFieldProps, "label" | "value" | "onChange">;
  loading?: boolean;
  problem?: PortalProblem | null;
  empty?: boolean;
  onRetry?: () => void;
  /** The rows (ConversationRow or RequestRow items) and a "Load more" button. */
  children: ReactNode;
}

/** The list pane: header, search field and the rows, or their loading, empty or error state. */
export function ListPane(props: ListPaneProps) {
  const { t } = useTranslation("quills");
  const pane = useContext(DetailPaneContext);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListHeader
        title={props.title}
        headingLevel={props.headingLevel}
        filters={props.filters}
        actions={
          <>
            {props.actions}
            {pane ? (
              <IconButton
                className="hidden md:inline-flex"
                label={t("inbox.hideList")}
                onClick={pane.hideList}
              >
                <PanelLeftClose aria-hidden="true" />
              </IconButton>
            ) : null}
          </>
        }
      />
      {props.search ? (
        <div className="px-3 pb-2">
          <SearchField {...props.search} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <TeamStateView
          loading={props.loading}
          problem={props.problem}
          empty={props.empty}
          onRetry={props.onRetry}
        >
          {props.children}
        </TeamStateView>
      </div>
    </div>
  );
}
