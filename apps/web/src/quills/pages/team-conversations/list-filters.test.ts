import { describe, expect, it } from "vite-plus/test";
import type { SavedView } from "./conversation-list";
import {
  chooseFilter,
  filterValue,
  listTitle,
  savedValue,
  viewRules,
} from "./list-filters";

const view: SavedView = {
  id: "view_test_1",
  name: "Billing",
  filters: { rules: [] },
  sort: null,
  isShared: true,
  isPinned: false,
  createdByPrincipalId: null,
};
const label = (key: string) => key;

describe("list filters", () => {
  it("checks the filter or the saved view of a list", () => {
    expect(filterValue({ view: "open", status: "open" })).toBe("open");
    expect(filterValue({ view: "all", status: "closed" })).toBe("resolved");
    expect(filterValue({ view: "all", status: "spam" })).toBe("spam");
    expect(
      filterValue({ view: "mine", status: "open", savedView: "view_test_1" }),
    ).toBe(savedValue("view_test_1"));
    // My snoozed conversations have no menu item.
    expect(filterValue({ view: "mine", status: "snoozed" })).toBe("");
  });

  it("chooses a filter with the search, or a saved view in the same scope", () => {
    const context = {
      view: "mine",
      status: "open",
      savedView: "view_old",
      search: "refund",
    } as const;
    expect(chooseFilter(context, "snoozed")).toEqual({
      view: "all",
      status: "snoozed",
      search: "refund",
    });
    expect(chooseFilter(context, savedValue("view_test_1"))).toEqual({
      ...context,
      savedView: "view_test_1",
    });
    expect(chooseFilter(context, "unknown")).toBeNull();
  });

  it("titles a list by its saved view, its filter or its view", () => {
    expect(
      listTitle(
        { view: "all", status: "any", savedView: "view_test_1" },
        [view],
        label,
      ),
    ).toBe("Billing");
    expect(listTitle({ view: "all", status: "spam" }, [], label)).toBe(
      "team-conversations.filters.spam",
    );
    expect(listTitle({ view: "queue", status: "open" }, [], label)).toBe(
      "team-conversations.views.queue",
    );
  });

  it("saves a list as view rules, except spam, a search and a saved view", () => {
    expect(viewRules({ view: "mine", status: "snoozed" })).toEqual([
      { field: "assignee", value: "me" },
      { field: "status", value: "snoozed" },
    ]);
    expect(viewRules({ view: "unassigned", status: "any" })).toEqual([
      { field: "assignee", value: "unassigned" },
    ]);
    expect(viewRules({ view: "queue", status: "open" })).toEqual([
      { field: "status", value: "open" },
      { field: "waiting", value: true },
    ]);
    expect(viewRules({ view: "all", status: "spam" })).toBeNull();
    expect(
      viewRules({ view: "all", status: "any", search: "refund" }),
    ).toBeNull();
    expect(
      viewRules({ view: "all", status: "any", savedView: "view_test_1" }),
    ).toBeNull();
  });
});
