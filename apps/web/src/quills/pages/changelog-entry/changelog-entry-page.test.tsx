import { describe, expect, it } from "vite-plus/test";
import { getPortalChangelogEntryFixture } from "../../api/changelog/get-portal-changelog-entry.fixture";
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
  });
  describe("behavior", () => {
    it("keeps inaccessible entries behind the detail operation", () => {
      expect(meta.operations).toEqual(["getQuillsPortalChangelogEntry"]);
    });
  });
});
