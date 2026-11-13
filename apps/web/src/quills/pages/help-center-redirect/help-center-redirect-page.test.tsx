import { describe, expect, it } from "vite-plus/test";
import { resolvePublicHelpCenterRedirectFixture } from "../../api/help-center/resolve-public-help-center-redirect.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { meta } from "./meta";
import { HelpCenterRedirectPage } from "./help-center-redirect-page";
describe("HelpCenterRedirectPage", () => {
  const options = { params: { _splat: "old-guide" } };
  describePageContract(meta, HelpCenterRedirectPage, {
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
          resolvePublicHelpCenterRedirectFixture.ok({ target: "/hc" }),
        );
        return options;
      },
    },
  });
  describe("behavior", () => {
    it("resolves unmatched legacy paths", () => {
      expect(meta.operations).toContain(
        "resolveQuillsPublicHelpCenterRedirect",
      );
    });
  });
});
