import { useTranslation } from "react-i18next";
import { Input, Label } from "../../../ui/upstream";
export interface PostFiltersProps {
  search: string;
  sort: string;
  stage: string;
  stages: Array<{ value: string; label: string }>;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onStageChange: (value: string) => void;
}
export function PostFilters(props: PostFiltersProps) {
  const { t } = useTranslation("quills");
  return (
    <div role="search">
      <Label htmlFor="post-search">{t("feedback.search")}</Label>
      <Input
        id="post-search"
        value={props.search}
        onChange={(event) => props.onSearchChange(event.target.value)}
      />
      <Label htmlFor="post-stage">{t("feedback.stage")}</Label>
      <select
        id="post-stage"
        value={props.stage}
        onChange={(event) => props.onStageChange(event.target.value)}
      >
        <option value="">{t("feedback.allStages")}</option>
        {props.stages.map((stage) => (
          <option key={stage.value} value={stage.value}>
            {stage.label}
          </option>
        ))}
      </select>
      <Label htmlFor="post-sort">{t("feedback.sort")}</Label>
      <select
        id="post-sort"
        value={props.sort}
        onChange={(event) => props.onSortChange(event.target.value)}
      >
        <option value="newest">{t("feedback.newest")}</option>
        <option value="oldest">{t("feedback.oldest")}</option>
        <option value="votes">{t("feedback.votes")}</option>
      </select>
    </div>
  );
}
