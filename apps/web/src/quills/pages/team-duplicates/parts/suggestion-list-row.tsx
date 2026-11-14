import { useTranslation } from "react-i18next";
import { ListRow } from "../../../ui/inbox/list-row";
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
    <ListRow
      {...row}
      title={suggestion.source.title}
      preview={t("duplicates.duplicateOf", {
        target: suggestion.target.title,
      })}
      chips={[
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
