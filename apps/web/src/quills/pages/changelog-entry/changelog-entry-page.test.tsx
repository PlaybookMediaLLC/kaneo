import { describe, expect, it } from "vite-plus/test";
import { getPortalChangelogEntryFixture } from "../../api/changelog/get-portal-changelog-entry.fixture";
import { setPortalChangelogReactionFixture } from "../../api/changelog/set-portal-changelog-reaction.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { meta } from "./meta";
import { ChangelogEntryPage } from "./changelog-entry-page";
describe("ChangelogEntryPage", () => {
  const options = { params: { entryId: "entry_test_1" } };
  describePageContract(meta, ChangelogEntryPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return options;
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
        return options;
      },
    },
    ready: {
      prepare: () => {
        mockApi().reply(
          getPortalChangelogEntryFixture.ok({ title: "November release" }),
        );
        return options;
      },
      assert: async (view) => {
        await view.findByRole("heading", { name: "November release" });
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(
          getPortalChangelogEntryFixture.ok({ title: "November release" }),
        );
        api.reply(setPortalChangelogReactionFixture.ok({ changed: true }));
        api.reply(
          getPortalChangelogEntryFixture.ok({
            title: "November release",
            reactions: [{ emoji: "🚀", count: 1, reacted: true }],
          }),
        );
        return {
          ...options,
          viewer: { kind: "user" as const, id: "account_test_1" },
        };
      },
      act: async (view) => {
        await view.findByRole("heading", { name: "November release" });
        press("🚀 0");
      },
      assert: async (view) => {
        expect(
          await view.findByRole("button", { name: "🚀 1", pressed: true }),
        ).toBeInTheDocument();
      },
    },
  });
  describe("behavior", () => {
    it("keeps inaccessible entries behind the detail operation", () => {
      expect(meta.operations).toEqual([
        "getQuillsPortalChangelogEntry",
        "setQuillsPortalChangelogReaction",
      ]);
    });
  });
});
