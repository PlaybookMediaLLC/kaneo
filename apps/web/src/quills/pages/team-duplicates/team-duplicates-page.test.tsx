import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { acceptSuggestionFixture } from "../../api/team/accept-suggestion.fixture";
import { dismissSuggestionFixture } from "../../api/team/dismiss-suggestion.fixture";
import { listMergeSuggestionsFixture } from "../../api/team/list-merge-suggestions.fixture";
import { restoreSuggestionFixture } from "../../api/team/restore-suggestion.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { suggestionsFixture } from "./suggestions.fixture";
import { TeamDuplicatesPage } from "./team-duplicates-page";

const suggestion = suggestionsFixture.suggestion;
const other = suggestion({
  id: "suggestion_test_2",
  source: {
    id: "post_test_3",
    title: "Export to CSV",
    voteCount: 1,
    boardName: "Bugs",
    statusName: null,
  },
});
/** Renders the page and opens the first pair. */
const openPair = async (permissions = {}) => {
  const view = renderPage(TeamDuplicatesPage, meta, { permissions });
  fireEvent.click(await view.findByRole("link", { name: /Dark theme/ }));
  await view.findByRole("heading", {
    level: 1,
    name: "“Dark theme” and “Dark mode”",
  });
  return view;
};

describe("TeamDuplicatesPage", () => {
  describePageContract(meta, TeamDuplicatesPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
      },
    },
    ready: {
      prepare: () => {
        const api = mockApi();
        api.reply(listMergeSuggestionsFixture.ok());
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(listMergeSuggestionsFixture.ok());
      },
    },
  });

  describe("behavior", () => {
    it("groups the pairs by board, opens one and merges the duplicate into the post to keep", async () => {
      const api = mockApi();
      api.reply(suggestionsFixture.list([suggestion(), other]));
      api.reply(acceptSuggestionFixture.ok());
      api.reply(suggestionsFixture.list([other]));
      const view = renderPage(TeamDuplicatesPage, meta);
      expect(
        await view.findByRole("group", { name: "Ideas 1" }),
      ).toHaveTextContent("Dark theme");
      expect(view.getByRole("group", { name: "Bugs 1" })).toHaveTextContent(
        "Export to CSV",
      );
      const list = new URL(api.calls("listQuillsMergeSuggestions")[0]!.url);
      expect(list.searchParams.get("status")).toBe("pending");
      fireEvent.click(view.getByRole("link", { name: /Dark theme/ }));
      expect(
        await view.findByRole("heading", {
          level: 1,
          name: "“Dark theme” and “Dark mode”",
        }),
      ).toHaveFocus();
      expect(view.getByText("Ideas · Planned")).toBeInTheDocument();
      expect(view.getByText("9 votes")).toBeInTheDocument();
      press("Merge");
      expect(
        await view.findByText("Merged “Dark theme” into “Dark mode”."),
      ).toHaveAttribute("role", "status");
      const [merge] = api.calls("acceptQuillsSuggestion");
      expect(new URL(merge!.url).pathname).toContain(
        "/suggestions/suggestion_test_1/accept",
      );
      expect(await merge!.clone().json()).toEqual({ swapDirection: false });
      // The next pair opens, because the merged one left the list.
      expect(
        await view.findByRole("heading", {
          level: 1,
          name: "“Export to CSV” and “Dark mode”",
        }),
      ).toBeInTheDocument();
    });

    it("dismisses a pending pair and returns to the empty list", async () => {
      const api = mockApi();
      api.reply(suggestionsFixture.list([suggestion()]));
      api.reply(dismissSuggestionFixture.ok());
      api.reply(listMergeSuggestionsFixture.ok());
      const view = await openPair();
      press("Dismiss");
      expect(
        await view.findByText("Dismissed: “Dark theme” and “Dark mode”."),
      ).toBeInTheDocument();
      expect(api.calls("dismissQuillsSuggestion")).toHaveLength(1);
      expect(
        view.getByRole("heading", { level: 1, name: "Duplicates" }),
      ).toBeInTheDocument();
      expect(view.getByText("Nothing is here yet.")).toBeInTheDocument();
    });

    it("lists the dismissed pairs and restores one", async () => {
      const api = mockApi();
      api.reply(listMergeSuggestionsFixture.ok());
      api.reply(suggestionsFixture.list([suggestion({ status: "dismissed" })]));
      api.reply(restoreSuggestionFixture.ok());
      api.reply(listMergeSuggestionsFixture.ok());
      const view = renderPage(TeamDuplicatesPage, meta);
      await view.findByText("Nothing is here yet.");
      press("Filters");
      fireEvent.click(
        await view.findByRole("menuitemradio", { name: "Dismissed" }),
      );
      expect(
        await view.findByRole("heading", { level: 1, name: "Dismissed pairs" }),
      ).toBeInTheDocument();
      fireEvent.click(await view.findByRole("link", { name: /Dark theme/ }));
      const dismissed = new URL(
        api.calls("listQuillsMergeSuggestions")[1]!.url,
      );
      expect(dismissed.searchParams.get("status")).toBe("dismissed");
      expect(view.queryByRole("button", { name: "Merge" })).toBeNull();
      press("Restore");
      expect(
        await view.findByText("Restored: “Dark theme” and “Dark mode”."),
      ).toBeInTheDocument();
      expect(api.calls("restoreQuillsSuggestion")).toHaveLength(1);
    });

    it("hides the decisions from a teammate without update", async () => {
      const api = mockApi();
      api.reply(suggestionsFixture.list([suggestion()]));
      const view = await openPair({ update: false });
      expect(view.queryByRole("group", { name: "Pair actions" })).toBeNull();
    });
  });
});
