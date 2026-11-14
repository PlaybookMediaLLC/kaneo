import { useTranslation } from "react-i18next";
import { Button } from "../../../ui/upstream";

export const FEEDBACK_FILTERS = ["all", "mine", "voted", "following"] as const;
export type FeedbackFilterValue = (typeof FEEDBACK_FILTERS)[number];

const LABELS: Record<FeedbackFilterValue, string> = {
  all: "my-feedback.filters.all",
  mine: "my-feedback.filters.mine",
  voted: "my-feedback.filters.voted",
  following: "my-feedback.filters.following",
};

export interface FeedbackFilterProps {
  value: FeedbackFilterValue;
  onChange: (value: FeedbackFilterValue) => void;
}

/** Which of the caller's posts to show. */
export function FeedbackFilter({ value, onChange }: FeedbackFilterProps) {
  const { t } = useTranslation("quills");
  return (
    <div
      role="group"
      aria-label={t("my-feedback.filter")}
      className="flex flex-wrap gap-1.5"
    >
      {FEEDBACK_FILTERS.map((filter) => (
        <Button
          key={filter}
          type="button"
          size="sm"
          variant={filter === value ? "secondary" : "ghost"}
          aria-pressed={filter === value}
          onClick={() => onChange(filter)}
        >
          {t(LABELS[filter])}
        </Button>
      ))}
    </div>
  );
}
