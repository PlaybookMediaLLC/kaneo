import { useTranslation } from "react-i18next";
import { relativeTime } from "../../../core/relative-time";
import { PropertyRow } from "../../../ui/inbox/property-row";
import type { Suggestion } from "./suggestion-detail";

export interface SuggestionPropertiesProps {
  suggestion: Suggestion;
}

const statusKeys = {
  pending: "duplicates.pending",
  accepted: "duplicates.statusMerged",
  dismissed: "duplicates.dismissed",
  expired: "duplicates.statusExpired",
} as const;

/** The properties panel of a pair: its status, the AI confidence and when it was found. */
export function SuggestionProperties({
  suggestion,
}: SuggestionPropertiesProps) {
  const { t, i18n } = useTranslation("quills");
  return (
    <div>
      <PropertyRow label={t("duplicates.status")}>
        {t(statusKeys[suggestion.status])}
      </PropertyRow>
      <PropertyRow label={t("duplicates.confidence")}>
        {t("duplicates.percent", {
          percent: Math.round(suggestion.llmConfidence * 100),
        })}
      </PropertyRow>
      <PropertyRow label={t("duplicates.found")}>
        <time dateTime={suggestion.createdAt}>
          {relativeTime(suggestion.createdAt, i18n.language)}
        </time>
      </PropertyRow>
    </div>
  );
}
