import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { teamHref } from "../../../team/team-href";
import { TeamStateView } from "../../../team/team-state-view";
import { DetailHeader } from "../../../ui/inbox/detail-header";
import { DetailLayout } from "../../../ui/inbox/detail-layout";
import { ListPane } from "../../../ui/inbox/list-pane";
import { useListNavigation } from "../../../ui/inbox/use-list-navigation";
import {
  SuggestionActions,
  type SuggestionActionsProps,
} from "./suggestion-actions";
import { SuggestionDetail, type Suggestion } from "./suggestion-detail";
import { SuggestionListRow } from "./suggestion-list-row";
import { SuggestionProperties } from "./suggestion-properties";

export interface SuggestionViewProps {
  workspaceId: string;
  suggestion: Suggestion;
  /** The pairs of the list in display order, for the compact list. */
  suggestions: readonly Suggestion[];
  /** The result of the last decision. */
  message: string;
  /** The problem of the last decision. */
  problem: PortalProblem | null;
  onMove: (id: string) => void;
  onBack: () => void;
  actions: Omit<SuggestionActionsProps, "suggestion">;
}

/** The open pair in three panes: the compact list, the pair with its decisions, and its properties. */
export function SuggestionView({
  suggestion,
  suggestions,
  ...props
}: SuggestionViewProps) {
  const { t } = useTranslation("quills");
  const nav = useListNavigation({
    ids: suggestions.map((item) => item.id),
    activeId: suggestion.id,
    onMove: props.onMove,
    onBack: props.onBack,
  });
  return (
    <DetailLayout
      list={
        <ListPane title={t("duplicates.title")} headingLevel={2}>
          <ul className="grid gap-0.5">
            {suggestions.map((item) => (
              <li key={item.id}>
                <SuggestionListRow
                  suggestion={item}
                  href={teamHref(props.workspaceId, "/duplicates")}
                  compact
                  selected={item.id === suggestion.id}
                  onOpen={() => props.onMove(item.id)}
                />
              </li>
            ))}
          </ul>
        </ListPane>
      }
      listLabel={t("duplicates.title")}
      properties={<SuggestionProperties suggestion={suggestion} />}
      propertiesLabel={t("duplicates.properties")}
    >
      <DetailHeader
        onBack={props.onBack}
        onPrevious={nav.previous}
        onNext={nav.next}
      >
        <div className="min-w-0">
          <h1
            tabIndex={-1}
            className="line-clamp-2 text-lg font-semibold leading-tight outline-none"
          >
            {t("duplicates.pair", {
              source: suggestion.source.title,
              target: suggestion.target.title,
            })}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {t("duplicates.match", {
              percent: Math.round(suggestion.hybridScore * 100),
            })}
          </p>
        </div>
      </DetailHeader>
      <SuggestionDetail suggestion={suggestion} />
      <p
        role="status"
        className="px-6 text-sm text-muted-foreground [&:not(:empty)]:pb-2"
      >
        {props.message}
      </p>
      <div className="px-6">
        <TeamStateView problem={props.problem}>{null}</TeamStateView>
      </div>
      <div className="grow" />
      <SuggestionActions suggestion={suggestion} {...props.actions} />
    </DetailLayout>
  );
}
