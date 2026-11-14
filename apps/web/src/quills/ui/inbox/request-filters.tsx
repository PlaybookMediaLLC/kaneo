import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "../upstream";

export interface RequestFiltersProps {
  /** The status group: active, complete, closed or all. Empty while one status is shown. */
  status: string;
  /** The board ID, or "" for every board. */
  board: string;
  /** newest, votes or rice. */
  sort: string;
  boards: readonly { id: string; name: string }[];
  onChange: (key: RequestFilterKey, value: string) => void;
}

const statuses = [
  { value: "active", labelKey: "team-posts.open" },
  { value: "complete", labelKey: "team-posts.complete" },
  { value: "closed", labelKey: "team-posts.closed" },
  { value: "all", labelKey: "team-posts.all" },
] as const;
const sorts = [
  { value: "newest", labelKey: "team-posts.sortNewest" },
  { value: "votes", labelKey: "team-posts.sortVotes" },
  { value: "rice", labelKey: "team-posts.sortRice" },
] as const;

/** The filter menu items of a request list: the status group, the board and the sort. */
export function RequestFilters(props: RequestFiltersProps) {
  const { t } = useTranslation("quills");
  const groups = [
    {
      key: "status",
      labelKey: "team-posts.show",
      value: props.status,
      options: statuses.map((item) => ({
        value: item.value,
        label: t(item.labelKey),
      })),
    },
    {
      key: "board",
      labelKey: "team-posts.board",
      value: props.board,
      options: [
        { value: "", label: t("team-posts.allBoards") },
        ...props.boards.map((board) => ({
          value: board.id,
          label: board.name,
        })),
      ],
    },
    {
      key: "sort",
      labelKey: "team-posts.sort",
      value: props.sort,
      options: sorts.map((item) => ({
        value: item.value,
        label: t(item.labelKey),
      })),
    },
  ] as const;
  return groups.map((group, index) => (
    <Fragment key={group.key}>
      {index ? <MenuSeparator /> : null}
      <MenuGroup>
        <MenuGroupLabel>{t(group.labelKey)}</MenuGroupLabel>
        <MenuRadioGroup
          value={group.value}
          onValueChange={(value) => props.onChange(group.key, String(value))}
        >
          {group.options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
    </Fragment>
  ));
}

/** The filter group of a menu choice. */
export type RequestFilterKey = "status" | "board" | "sort";
