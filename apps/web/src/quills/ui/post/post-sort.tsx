import { useTranslation } from "react-i18next";
import { PortalSelectContent } from "../portal-select-content";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../upstream";

export interface PostSortProps {
  sort: string;
  onSortChange: (value: string) => void;
}

export function PostSort(props: PostSortProps) {
  const { t } = useTranslation("quills");
  const sorts = [
    { value: "votes", label: t("feedback.votes") },
    { value: "newest", label: t("feedback.newest") },
    { value: "oldest", label: t("feedback.oldest") },
  ];
  return (
    <div className="portal-post-sort flex items-center justify-between gap-4">
      <h2 className="text-xs font-normal text-muted-foreground">
        {t("feedback.posts")}
      </h2>
      <Select
        items={sorts}
        value={props.sort}
        onValueChange={(value) => {
          if (value !== null) props.onSortChange(value);
        }}
      >
        <SelectTrigger
          aria-label={t("feedback.sort")}
          className="min-h-7 w-auto min-w-0 gap-1 border-0 bg-transparent px-1.5 text-xs shadow-none before:hidden sm:min-h-7 sm:text-xs dark:bg-transparent [&_svg]:size-3"
        >
          <SelectValue />
        </SelectTrigger>
        <PortalSelectContent align="end" alignItemWithTrigger={false}>
          <SelectGroup>
            {sorts.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </PortalSelectContent>
      </Select>
    </div>
  );
}
