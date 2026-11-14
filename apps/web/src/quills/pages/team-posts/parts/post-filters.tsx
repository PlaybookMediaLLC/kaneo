import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ListBoardsResponse } from "../../../api/team/list-boards";
import { Input, useDebouncedValue } from "../../../ui/upstream";
import type { PostSearch } from "../post-search";

export interface PostFiltersProps {
  boards: ListBoardsResponse["items"];
  search: PostSearch;
  onChange: (patch: Partial<PostSearch>) => void;
}

const select =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sorts = [
  { value: "newest", labelKey: "team-posts.sortNewest" },
  { value: "votes", labelKey: "team-posts.sortVotes" },
  { value: "rice", labelKey: "team-posts.sortRice" },
] as const;
/** The F key focuses the board filter and the V key the sort. */
export const postFilterIds = {
  board: "team-posts-board",
  sort: "team-posts-sort",
} as const;

/** The search field, the board filter and the sort of the feedback inbox. */
export function PostFilters({ boards, search, onChange }: PostFiltersProps) {
  const { t } = useTranslation("quills");
  const [text, setText] = useState(search.q ?? "");
  const query = useDebouncedValue(text.trim(), 300);
  // A typed value reaches the address after a pause, once.
  const sent = useRef(query);
  useEffect(() => {
    if (query === sent.current) return;
    sent.current = query;
    onChange({ q: query || undefined });
  }, [query, onChange]);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <label className="min-w-40 flex-1">
        <span className="sr-only">{t("team-posts.search")}</span>
        <Input
          type="search"
          size="sm"
          value={text}
          placeholder={t("team-posts.search")}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t("team-posts.board")}
        <select
          id={postFilterIds.board}
          className={select}
          value={search.board ?? ""}
          onChange={(event) =>
            onChange({ board: event.target.value || undefined })
          }
        >
          <option value="">{t("team-posts.allBoards")}</option>
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {t("team-posts.sort")}
        <select
          id={postFilterIds.sort}
          className={select}
          value={search.sort ?? "newest"}
          onChange={(event) =>
            onChange({ sort: event.target.value as PostSearch["sort"] })
          }
        >
          {sorts.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {t(sort.labelKey)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
