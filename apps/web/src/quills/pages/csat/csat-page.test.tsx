import { describe, expect, it, vi } from "vite-plus/test";
import { recordCsatViaTokenFixture } from "../../api/support/record-csat-via-token.fixture";
import { validateCsatEmailTokenFixture } from "../../api/support/validate-csat-email-token.fixture";
import { stashToken } from "../../core/token-stash";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { CsatPage } from "./csat-page";
import { meta } from "./meta";

const scope = "workspace_test_1:csat";

describe("CsatPage", () => {
  describePageContract(meta, CsatPage, {
    loading: {
      prepare: () => {
        stashToken(scope, "mail_link_value");
        mockApi().defer(() => undefined);
      },
    },
    gone: {
      prepare: () => undefined,
    },
    failed: {
      prepare: () => {
        stashToken(scope, "mail_link_value");
        mockApi().fail();
      },
    },
    ready: {
      prepare: () => {
        stashToken(scope, "mail_link_value");
        mockApi().reply(validateCsatEmailTokenFixture.ok());
        return { search: { rating: 3 } };
      },
      assert: async (view) => {
        expect(
          await view.findByRole("combobox", { name: "Choose a rating" }),
        ).toHaveValue("3");
      },
    },
    done: {
      prepare: () => {
        stashToken(scope, "mail_link_value");
        const api = mockApi();
        api.reply(validateCsatEmailTokenFixture.ok());
        api.reply(recordCsatViaTokenFixture.ok({ rating: 4 }));
        api.reply(validateCsatEmailTokenFixture.ok({ valid: false }));
        return { search: { rating: 4 } };
      },
      act: async (view) => {
        await view.findByRole("button", { name: "Send rating" });
        press("Send rating");
      },
      assert: async (view) => {
        await view.findByText("Thanks for your feedback");
      },
    },
  });

  describe("behavior", () => {
    it("sends no rating on load and selects the linked rating accessibly", async () => {
      const api = mockApi();
      api.reply(validateCsatEmailTokenFixture.ok());
      stashToken(scope, "mail_link_value");
      const view = renderPage(CsatPage, meta, { search: { rating: 3 } });
      const rating = await view.findByRole("combobox", {
        name: "Choose a rating",
      });
      expect(rating).toHaveValue("3");
      expect(api.calls("validateQuillsCsatEmailToken")).toHaveLength(1);
      expect(api.calls("recordQuillsCsatViaToken")).toHaveLength(0);
    });

    it("records a changed rating only after explicit confirmation", async () => {
      const api = mockApi();
      api.reply(validateCsatEmailTokenFixture.ok());
      api.reply(recordCsatViaTokenFixture.ok({ rating: 4 }));
      api.reply(validateCsatEmailTokenFixture.ok({ valid: false }));
      stashToken(scope, "mail_link_value");
      const view = renderPage(CsatPage, meta, { search: { rating: 2 } });
      await view.findByRole("combobox", { name: "Choose a rating" });
      fill("Choose a rating", "4");
      press("Send rating");
      expect(
        await view.findByText("Thanks for your feedback"),
      ).toBeInTheDocument();
      expect(
        view.getByText("You rated this conversation 4 out of 5."),
      ).toBeInTheDocument();
      expect(api.calls("recordQuillsCsatViaToken")).toHaveLength(1);
      expect(
        await api.calls("recordQuillsCsatViaToken")[0].clone().json(),
      ).toEqual({ token: "mail_link_value", rating: 4 });
    });

    it("shows a missing token as gone without a request", () => {
      const api = mockApi();
      const view = renderPage(CsatPage, meta);
      expect(
        view.getByText(
          "This link is no longer valid. Open the latest email and try again.",
        ),
      ).toBeInTheDocument();
      expect(api.calls()).toHaveLength(0);
    });

    it("shows an expired or used token as gone", async () => {
      const api = mockApi();
      api.reply(validateCsatEmailTokenFixture.ok({ valid: false }));
      stashToken(scope, "mail_link_value");
      const view = renderPage(CsatPage, meta);
      expect(
        await view.findByText(
          "This link is no longer valid. Open the latest email and try again.",
        ),
      ).toBeInTheDocument();
      expect(api.calls("recordQuillsCsatViaToken")).toHaveLength(0);
    });

    it("refuses confirmation inside a frame", async () => {
      const api = mockApi();
      api.reply(validateCsatEmailTokenFixture.ok());
      stashToken(scope, "mail_link_value");
      vi.stubGlobal("top", {});
      const view = renderPage(CsatPage, meta, { search: { rating: 5 } });
      await view.findByRole("button", { name: "Send rating" });
      press("Send rating");
      expect(
        await view.findByText("Open this page in a new tab to continue."),
      ).toBeInTheDocument();
      expect(api.calls("recordQuillsCsatViaToken")).toHaveLength(0);
      vi.unstubAllGlobals();
    });
  });
});
