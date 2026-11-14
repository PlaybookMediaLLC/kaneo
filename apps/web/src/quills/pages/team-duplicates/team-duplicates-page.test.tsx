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
import { TeamDuplicatesPage } from "./team-duplicates-page";

const suggestion = (status: "pending" | "dismissed" = "pending") => ({
  id: "suggestion_test_1",
  status,
  source: {
    id: "post_test_1",
    title: "Dark theme",
    voteCount: 2,
    boardName: "Ideas",
    statusName: null,
  },
  target: {
    id: "post_test_2",
    title: "Dark mode",
    voteCount: 9,
    boardName: "Ideas",
    statusName: "Planned",
  },
  hybridScore: 0.93,
  llmConfidence: 0.9,
  llmReasoning: "Both ask for a dark color scheme.",
  createdAt: "2026-11-01T00:00:00.000Z",
  resolvedAt: null,
});

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
    it("shows both posts and merges the duplicate into the post to keep", async () => {
      const api = mockApi();
      api.reply(listMergeSuggestionsFixture.ok({ items: [suggestion()] }));
      api.reply(acceptSuggestionFixture.ok());
      api.reply(listMergeSuggestionsFixture.ok());
      const view = renderPage(TeamDuplicatesPage, meta);
      expect(await view.findByText("Dark theme")).toBeInTheDocument();
      expect(view.getByText("Ideas · Planned")).toBeInTheDocument();
      expect(view.getByText("9 votes")).toBeInTheDocument();
      expect(view.getByText("93% match")).toBeInTheDocument();
      const list = new URL(api.calls("listQuillsMergeSuggestions")[0]!.url);
      expect(list.searchParams.get("status")).toBe("pending");
      press("Merge: “Dark theme” into “Dark mode”");
      expect(
        await view.findByText("Merged “Dark theme” into “Dark mode”."),
      ).toHaveAttribute("role", "status");
      const [merge] = api.calls("acceptQuillsSuggestion");
      expect(new URL(merge!.url).pathname).toContain(
        "/suggestions/suggestion_test_1/accept",
      );
      expect(await merge!.clone().json()).toEqual({ swapDirection: false });
      expect(await view.findByText("Nothing is here yet.")).toBeInTheDocument();
    });

    it("dismisses a pending pair", async () => {
      const api = mockApi();
      api.reply(listMergeSuggestionsFixture.ok({ items: [suggestion()] }));
      api.reply(dismissSuggestionFixture.ok());
      api.reply(listMergeSuggestionsFixture.ok());
      const view = renderPage(TeamDuplicatesPage, meta);
      await view.findByText("Dark theme");
      press("Dismiss: “Dark theme” and “Dark mode”");
      expect(
        await view.findByText("Dismissed: “Dark theme” and “Dark mode”."),
      ).toBeInTheDocument();
      expect(api.calls("dismissQuillsSuggestion")).toHaveLength(1);
    });

    it("lists the dismissed pairs and restores one", async () => {
      const api = mockApi();
      api.reply(listMergeSuggestionsFixture.ok());
      api.reply(
        listMergeSuggestionsFixture.ok({ items: [suggestion("dismissed")] }),
      );
      api.reply(restoreSuggestionFixture.ok());
      api.reply(listMergeSuggestionsFixture.ok());
      const view = renderPage(TeamDuplicatesPage, meta);
      await view.findByText("Nothing is here yet.");
      press("Dismissed");
      expect(view.getByRole("button", { name: "Dismissed" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await view.findByText("Dark theme");
      const dismissed = new URL(
        api.calls("listQuillsMergeSuggestions")[1]!.url,
      );
      expect(dismissed.searchParams.get("status")).toBe("dismissed");
      expect(
        view.queryByRole("button", { name: /^Merge/ }),
      ).not.toBeInTheDocument();
      press("Restore: “Dark theme” and “Dark mode”");
      expect(
        await view.findByText("Restored: “Dark theme” and “Dark mode”."),
      ).toBeInTheDocument();
      expect(api.calls("restoreQuillsSuggestion")).toHaveLength(1);
    });

    it("hides the decisions from a teammate without update", async () => {
      const api = mockApi();
      api.reply(listMergeSuggestionsFixture.ok({ items: [suggestion()] }));
      const view = renderPage(TeamDuplicatesPage, meta, {
        permissions: { update: false },
      });
      await view.findByText("Dark theme");
      expect(view.queryByRole("button", { name: /^Merge/ })).toBeNull();
      expect(view.queryByRole("button", { name: /^Dismiss:/ })).toBeNull();
    });
  });
});
