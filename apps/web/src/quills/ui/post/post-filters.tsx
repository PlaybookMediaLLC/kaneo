import { PortalSelectContent } from "../portal-select-content";
import { useTranslation } from "react-i18next";
import {
  Input,
  Field,
  FieldLabel,
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../upstream";
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
  const stages = [
    { value: "all", label: t("feedback.allStages") },
    ...props.stages,
  ];
  const sorts = [
    { value: "newest", label: t("feedback.newest") },
    { value: "oldest", label: t("feedback.oldest") },
    { value: "votes", label: t("feedback.votes") },
  ];
  return (
    <div
      role="search"
      className="portal-post-filters grid grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_160px_150px] [&>div:first-child]:col-span-2 sm:[&>div:first-child]:col-span-1"
    >
      <Field>
        <FieldLabel htmlFor="post-search">{t("feedback.search")}</FieldLabel>
        <Input
          id="post-search"
          placeholder={t("feedback.search")}
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="post-stage">{t("feedback.stage")}</FieldLabel>
        <Select
          items={stages}
          value={props.stage || "all"}
          onValueChange={(value) => {
            if (value !== null)
              props.onStageChange(value === "all" ? "" : value);
          }}
        >
          <SelectTrigger id="post-stage">
            <SelectValue />
          </SelectTrigger>
          <PortalSelectContent>
            <SelectGroup>
              {stages.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </PortalSelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="post-sort">{t("feedback.sort")}</FieldLabel>
        <Select
          items={sorts}
          value={props.sort}
          onValueChange={(value) => {
            if (value !== null) props.onSortChange(value);
          }}
        >
          <SelectTrigger id="post-sort">
            <SelectValue />
          </SelectTrigger>
          <PortalSelectContent>
            <SelectGroup>
              {sorts.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </PortalSelectContent>
        </Select>
      </Field>
    </div>
  );
}
