import { act } from "@testing-library/react";
import { Route as Home } from "../../routes/portal/$workspaceId/index";
import { Route as Board } from "../../routes/portal/$workspaceId/boards/$boardId";
import { expect, it, vi } from "vite-plus/test";
import { renderQuillsHook } from "../test/render";
import { useFeedbackFilters } from "./use-feedback-filters";
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  )),
  useNavigate: () => navigate,
}));
it("restores URL filters and sends changes through router history", () => {
  const { result, rerender } = renderQuillsHook(
    ({ search }) => useFeedbackFilters(search),
    {
      initialProps: {
        search: { search: "exports", sort: "votes", stage: "planned" },
      },
    },
  );
  expect(result.current).toMatchObject({
    search: "exports",
    sort: "votes",
    stage: "planned",
  });
  result.current.setStage("");
  const options = navigate.mock.calls.at(-1)![0];
  expect(options.search({ search: "exports", stage: "planned" })).toEqual({
    search: "exports",
    stage: undefined,
  });
  expect(options.replace).toBe(false);
  rerender({ search: { search: "back", sort: "oldest", stage: "open" } });
  expect(result.current.search).toBe("back");
});

it("keeps a long draft within both actual route search contracts", () => {
  const { result, rerender } = renderQuillsHook(
    ({ search }) => useFeedbackFilters(search),
    { initialProps: { search: { search: "x".repeat(200) } } },
  );
  act(() => result.current.setSearch("x".repeat(201)));
  const next = navigate.mock.calls.at(-1)![0].search({});
  expect(result.current.search).toBe("x".repeat(200));
  for (const route of [Home, Board]) {
    const validator = route.options.validateSearch;
    if (!validator || !("parse" in validator))
      throw new Error("Expected route schema");
    expect(validator.parse(next)).toMatchObject({
      search: result.current.search,
    });
  }
  rerender({ search: next });
  expect(result.current.search).toHaveLength(200);
});
