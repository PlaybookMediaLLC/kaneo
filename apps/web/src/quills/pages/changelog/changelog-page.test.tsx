import { describe, expect, it } from "vite-plus/test";
import { getPortalChangelogEntryFixture } from "../../api/changelog/get-portal-changelog-entry.fixture";
import { listPortalChangelogFixture } from "../../api/changelog/list-portal-changelog.fixture";
import { setPortalChangelogReactionFixture } from "../../api/changelog/set-portal-changelog-reaction.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { ChangelogPage } from "./changelog-page";
describe("ChangelogPage", () => {
  const signedIn = { viewer: { kind: "user" as const, id: "account_test_1" } };
  const update = (reacted: boolean) =>
    listPortalChangelogFixture.ok({
      entries: [
        getPortalChangelogEntryFixture.ok({
          title: "November release",
          reactions: reacted ? [{ emoji: "🎉", count: 1, reacted: true }] : [],
        }),
      ],
    });
  describePageContract(meta, ChangelogPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
      },
    },
    ready: {
      prepare: () => {
        mockApi().reply(
          listPortalChangelogFixture.ok({
            entries: [
              getPortalChangelogEntryFixture.ok({ title: "November release" }),
            ],
          }),
        );
      },
      assert: async (view) => {
        await view.findByRole("link", { name: "November release" });
        expect(view.getByRole("link", { name: "RSS feed" })).toHaveAttribute(
          "href",
          expect.stringMatching(
            /\/quills-public\/workspace_test_1\/changelog\/rss\.xml$/,
          ),
        );
        expect(view.getByText("You’re all caught up")).toBeInTheDocument();
        expect(
          view.getByRole("link", { name: "Get email updates" }),
        ).toHaveAttribute("href", "/portal/workspace_test_1/preferences");
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(update(false));
        api.reply(setPortalChangelogReactionFixture.ok({ changed: true }));
        api.reply(update(true));
        return signedIn;
      },
      act: async (view) => {
        await view.findByRole("link", { name: "November release" });
        press("🎉 0");
      },
      assert: async (view) => {
        expect(
          await view.findByRole("button", { name: "🎉 1", pressed: true }),
        ).toBeInTheDocument();
      },
    },
  });
  describe("behavior", () => {
    it("shows reactions read-only to a visitor", async () => {
      mockApi().reply(update(true));
      const view = renderPage(ChangelogPage, meta);
      expect(await view.findByRole("button", { name: "🎉 1" })).toBeDisabled();
      expect(view.queryByRole("button", { name: "👍 0" })).toBeNull();
    });
    it("does not request private changelog data without portal access", async () => {
      const api = mockApi();
      const view = renderPage(ChangelogPage, meta, { accessGranted: false });
      expect(await view.findByRole("status")).toHaveTextContent(/sign in/i);
      expect(api.calls()).toHaveLength(0);
    });
  });
});
