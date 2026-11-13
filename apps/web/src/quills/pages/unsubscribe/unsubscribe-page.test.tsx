import { describe, expect, it, vi } from "vite-plus/test";
import { previewUnsubscribeTokenFixture } from "../../api/notifications/preview-unsubscribe-token.fixture";
import { processUnsubscribeTokenFixture } from "../../api/notifications/process-unsubscribe-token.fixture";
import { stashToken } from "../../core/token-stash";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { UnsubscribePage } from "./unsubscribe-page";

describe("UnsubscribePage", () => {
  const scope = "workspace_test_1:unsubscribe";
  describePageContract(meta, UnsubscribePage, {
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
        mockApi().reply(previewUnsubscribeTokenFixture.ok({ valid: true }));
      },
      assert: async (view) => {
        await view.findByRole("button", { name: /unsubscribe/i });
      },
    },
    done: {
      prepare: () => {
        stashToken(scope, "mail_link_value");
        const api = mockApi();
        api.reply(previewUnsubscribeTokenFixture.ok({ valid: true }));
        api.reply(processUnsubscribeTokenFixture.ok({ processed: true }));
        api.reply(previewUnsubscribeTokenFixture.ok({ valid: false }));
      },
      act: async (view) => {
        await view.findByRole("button", { name: /unsubscribe/i });
        press(/unsubscribe/i);
      },
      assert: async (view) => {
        await view.findByText("You are unsubscribed");
      },
    },
  });

  describe("behavior", () => {
    it("sends no unsubscribe request on load", async () => {
      const api = mockApi();
      api.reply(previewUnsubscribeTokenFixture.ok({ valid: true }));
      stashToken("workspace_test_1:unsubscribe", "mail_link_value");
      const view = renderPage(UnsubscribePage, meta);
      await view.findByRole("button", { name: /unsubscribe/i });
      expect(api.calls()).toHaveLength(1);
    });

    it("keeps the success result after the consumed token preview refreshes", async () => {
      const api = mockApi();
      api.reply(previewUnsubscribeTokenFixture.ok({ valid: true }));
      api.reply(processUnsubscribeTokenFixture.ok({ processed: true }));
      api.reply(previewUnsubscribeTokenFixture.ok({ valid: false }));
      stashToken("workspace_test_1:unsubscribe", "mail_link_value");
      const view = renderPage(UnsubscribePage, meta);
      await view.findByRole("button", { name: /unsubscribe/i });
      press(/unsubscribe/i);
      await view.findByText("You are unsubscribed");
      expect(api.calls()).toHaveLength(3);
      expect(api.calls().filter((call) => call.method === "POST")).toHaveLength(
        1,
      );
    });

    it("refuses confirmation in a frame", async () => {
      const api = mockApi();
      api.reply(previewUnsubscribeTokenFixture.ok({ valid: true }));
      stashToken("workspace_test_1:unsubscribe", "mail_link_value");
      vi.stubGlobal("top", {});
      const view = renderPage(UnsubscribePage, meta);
      await view.findByRole("button", { name: /unsubscribe/i });
      press(/unsubscribe/i);
      const alerts = await view.findAllByRole("alert");
      expect(
        alerts.some((alert) => /new tab/i.test(alert.textContent ?? "")),
      ).toBe(true);
      expect(api.calls()).toHaveLength(1);
      vi.unstubAllGlobals();
    });
  });
});
