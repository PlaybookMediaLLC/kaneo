import { describe, expect, it } from "vite-plus/test";
import { describePageContract } from "../../test/contracts";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { OauthResultPage } from "./oauth-result-page";

describe("OauthResultPage", () => {
  describePageContract(meta, OauthResultPage, {
    failed: {
      prepare: () => ({ search: { outcome: "failed" } }),
    },
    ready: {
      prepare: () => ({ search: { outcome: "connected" } }),
      assert: async (view) => {
        await view.findByRole("status");
      },
    },
  });

  describe("behavior", () => {
    it.each([
      ["connected", /connected/i, "status"],
      ["already_used", /already complete/i, "status"],
      ["denied", /did not grant access/i, "alert"],
      ["unauthorized", /could not be verified/i, "alert"],
      ["no_access", /permission/i, "alert"],
      ["not_found", /could not be found/i, "alert"],
      ["restart", /start the connection again/i, "alert"],
      ["failed", /could not be completed/i, "alert"],
    ])("shows the static %s outcome", (outcome, text, role) => {
      const view = renderPage(OauthResultPage, meta, { search: { outcome } });
      expect(view.getByRole(role)).toHaveTextContent(text);
      expect(
        view.getByRole("link", { name: /return to dashboard/i }),
      ).toHaveAttribute("href", "/");
    });

    it("does not render callback-controlled text or secrets", () => {
      const unsafe = "Provider text code=secret-token-value";
      const view = renderPage(OauthResultPage, meta, {
        search: {
          outcome: "connected",
          name: unsafe,
          error: unsafe,
          code: unsafe,
          token: unsafe,
        },
      });
      expect(view.queryByText(unsafe)).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent("secret-token-value");
    });

    it("fails closed for a missing or unknown outcome", () => {
      for (const search of [{}, { outcome: "provider_supplied_error" }]) {
        const view = renderPage(OauthResultPage, meta, { search });
        expect(view.getByRole("alert")).toHaveTextContent(
          /could not be completed/i,
        );
        view.unmount();
      }
    });
  });
});
