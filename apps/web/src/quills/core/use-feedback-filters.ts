import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
export function useFeedbackFilters(input: Record<string, unknown>) {
  const navigate = useNavigate();
  const initialSearch =
    typeof input.search === "string" ? input.search.slice(0, 200) : "";
  const initialStage = ["open", "planned", "in_progress", "shipped"].includes(
    String(input.stage),
  )
    ? String(input.stage)
    : "";
  const initialSort =
    input.sort === "votes" || input.sort === "oldest" ? input.sort : "newest";
  const [search, setSearch] = useState(initialSearch);
  const [stage, setStage] = useState(initialStage);
  const [sort, setSort] = useState(initialSort);
  useEffect(() => {
    setSearch(initialSearch);
    setStage(initialStage);
    setSort(initialSort);
  }, [initialSearch, initialStage, initialSort]);
  const change = (key: string, value: string) => {
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        [key]: value || undefined,
      }),
      replace: key === "search",
      resetScroll: false,
    });
  };
  return {
    search,
    stage,
    sort,
    setSearch: (value: string) => {
      const bounded = value.slice(0, 200);
      setSearch(bounded);
      change("search", bounded);
    },
    setStage: (value: string) => {
      setStage(value);
      change("stage", value);
    },
    setSort: (value: string) => {
      setSort(value === "votes" || value === "oldest" ? value : "newest");
      change("sort", value);
    },
  };
}
