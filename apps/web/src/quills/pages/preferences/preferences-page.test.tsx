import { describe, expect, it } from "vite-plus/test";
import { getMyChangelogSubscriptionFixture } from "../../api/portal/get-my-changelog-subscription.fixture";
import { getMyLanguagePreferenceFixture } from "../../api/portal/get-my-language-preference.fixture";
import { getMyStatusSubscriptionFixture } from "../../api/portal/get-my-status-subscription.fixture";
import { subscribeMyChangelogFixture } from "../../api/portal/subscribe-my-changelog.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { PreferencesPage } from "./preferences-page";

describe("PreferencesPage", () => {
  const signedIn = { viewer: { kind: "user" as const, id: "account_test_1" } };
  const prepareReady = () => {
    const api = mockApi();
    api.reply(getMyLanguagePreferenceFixture.ok());
    api.reply(getMyChangelogSubscriptionFixture.ok());
    api.reply(getMyStatusSubscriptionFixture.ok());
    return api;
  };
  describePageContract(meta, PreferencesPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return signedIn;
      },
    },
    rateLimited: {
      prepare: () => {
        mockApi().reply({ message: "Slow down" }, 429, { "retry-after": "60" });
        return signedIn;
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
        return signedIn;
      },
    },
    ready: {
      prepare: () => {
        prepareReady();
        return signedIn;
      },
      assert: async (view) => {
        expect(
          await view.findByRole("switch", {
            name: "Changelog email updates",
          }),
        ).not.toBeChecked();
      },
    },
    done: {
      prepare: () => {
        const api = prepareReady();
        api.reply(subscribeMyChangelogFixture.ok({ subscribed: true }));
        api.reply(getMyChangelogSubscriptionFixture.ok({ subscribed: true }));
        return signedIn;
      },
      act: async (view) => {
        (
          await view.findByRole("switch", {
            name: "Changelog email updates",
          })
        ).click();
      },
      assert: async (view) => {
        await view.findByRole("switch", {
          name: "Changelog email updates",
          checked: true,
        });
      },
    },
  });
  describe("behavior", () => {
    it("declares both directions of each subscription", () => {
      expect(meta.operations).toEqual(
        expect.arrayContaining([
          "subscribeQuillsMyChangelog",
          "unsubscribeQuillsMyChangelog",
          "subscribeQuillsStatus",
          "unsubscribeQuillsStatus",
        ]),
      );
    });

    it("keeps subscription controls disabled until a rate limit can be reset", async () => {
      const api = mockApi();
      api.reply(getMyLanguagePreferenceFixture.ok());
      api.reply(getMyChangelogSubscriptionFixture.ok());
      api.reply(getMyStatusSubscriptionFixture.ok());
      api.reply({ message: "Too many requests" }, 429, { "retry-after": "60" });
      const view = renderPage(PreferencesPage, meta, {
        viewer: { kind: "user", id: "account_test_1" },
      });
      const changelog = await view.findByRole("switch", {
        name: "Changelog email updates",
      });

      changelog.click();

      expect(await view.findByRole("alert")).toHaveTextContent(
        /too many requests/i,
      );
      expect(changelog).toBeDisabled();
      expect(
        view.getByRole("switch", { name: "Status page email updates" }),
      ).toBeDisabled();
      expect(
        view.getByRole("button", { name: /try again in/i }),
      ).toBeDisabled();
      changelog.click();
      expect(api.calls("subscribeQuillsMyChangelog")).toHaveLength(1);
    });
  });
});
