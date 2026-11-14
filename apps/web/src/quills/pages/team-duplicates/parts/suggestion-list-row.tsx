import { useTranslation } from "react-i18next";
import { RequestRow } from "../../../ui/inbox/request-row";
import type { Suggestion } from "./suggestion-detail";

export interface SuggestionListRowProps {
  suggestion: Suggestion;
  href: string;
  onOpen: () => void;
  selected?: boolean;
  compact?: boolean;
}

/** One pair in the duplicates list: the duplicate, the post to keep and the match. */
export function SuggestionListRow({
  suggestion,
  ...row
}: SuggestionListRowProps) {
  const { t } = useTranslation("quills");
  return (
    <RequestRow
      {...row}
      title={suggestion.source.title}
      detail={t("duplicates.duplicateOf", {
        target: suggestion.target.title,
      })}
      badges={[
        {
          id: "match",
          label: t("duplicates.match", {
            percent: Math.round(suggestion.hybridScore * 100),
          }),
        },
      ]}
      time={suggestion.createdAt}
    />
  );
}
