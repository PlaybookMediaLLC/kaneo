import { describe, expect, it } from "vite-plus/test";
import { getPortalChangelogEntryFixture } from "../../api/changelog/get-portal-changelog-entry.fixture";
import { listPortalChangelogFixture } from "../../api/changelog/list-portal-changelog.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { ChangelogPage } from "./changelog-page";
describe("ChangelogPage", () => {
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
      },
    },
  });
  describe("behavior", () => {
    it("does not request private changelog data without portal access", async () => {
      const api = mockApi();
      const view = renderPage(ChangelogPage, meta, { accessGranted: false });
      expect(await view.findByRole("status")).toHaveTextContent(/sign in/i);
      expect(api.calls()).toHaveLength(0);
    });
  });
});
