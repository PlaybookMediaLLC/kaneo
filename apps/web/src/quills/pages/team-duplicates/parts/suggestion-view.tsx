import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { teamHref } from "../../../team/team-href";
import { TeamStateView } from "../../../team/team-state-view";
import { DetailLayout } from "../../../ui/inbox/detail-layout";
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
  return (
    <DetailLayout
      list={
        <ul className="divide-y divide-border">
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
      }
      listLabel={t("duplicates.title")}
      ids={suggestions.map((item) => item.id)}
      activeId={suggestion.id}
      onMove={props.onMove}
      onBack={props.onBack}
      properties={<SuggestionProperties suggestion={suggestion} />}
      propertiesLabel={t("duplicates.properties")}
    >
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
