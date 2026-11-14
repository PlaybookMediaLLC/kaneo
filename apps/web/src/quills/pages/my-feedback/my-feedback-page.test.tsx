import { describe, expect, it } from "vite-plus/test";
import { listPortalMyFeedbackFixture } from "../../api/feedback/list-portal-my-feedback.fixture";
import { getMyWeeklyDigestPreferenceFixture } from "../../api/portal/get-my-weekly-digest-preference.fixture";
import { setMyWeeklyDigestPreferenceFixture } from "../../api/portal/set-my-weekly-digest-preference.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { MyFeedbackPage } from "./my-feedback-page";

const signedIn = { viewer: { kind: "user" as const, id: "account_test_1" } };
const item = {
  id: "post_test_1",
  title: "Dark mode",
  board: { id: "board_test_1", name: "Ideas" },
  status: { name: "Planned", color: "#3b82f6" },
  stage: "planned" as const,
  voteCount: 3,
  isAuthor: false,
  voted: true,
  following: false,
  lastChangedAt: "2026-01-01T00:00:00.000Z",
};
const prepareReady = () => {
  const api = mockApi();
  api.reply(listPortalMyFeedbackFixture.ok({ items: [item], nextOffset: 20 }));
  api.reply(getMyWeeklyDigestPreferenceFixture.ok({ weeklyDigest: true }));
  return api;
};

describe("MyFeedbackPage", () => {
  describePageContract(meta, MyFeedbackPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
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
          await view.findByRole("link", { name: "Dark mode" }),
        ).toHaveAttribute("href", "/portal/workspace_test_1/posts/post_test_1");
        expect(
          view.getByRole("switch", { name: "Weekly digest email" }),
        ).toBeChecked();
        expect(
          view.getByRole("button", { name: "Load more feedback" }),
        ).toBeInTheDocument();
      },
    },
    done: {
      prepare: () => {
        const api = prepareReady();
        api.reply(
          setMyWeeklyDigestPreferenceFixture.ok({ weeklyDigest: false }),
        );
        api.reply(
          getMyWeeklyDigestPreferenceFixture.ok({ weeklyDigest: false }),
        );
        return signedIn;
      },
      act: async (view) => {
        (
          await view.findByRole("switch", { name: "Weekly digest email" })
        ).click();
      },
      assert: async (view) => {
        await view.findByRole("switch", {
          name: "Weekly digest email",
          checked: false,
        });
      },
    },
  });

  describe("behavior", () => {
    it("asks the API for the chosen filter", async () => {
      const api = prepareReady();
      api.reply(listPortalMyFeedbackFixture.ok());
      const view = renderPage(MyFeedbackPage, meta, signedIn);
      await view.findByRole("link", { name: "Dark mode" });
      press("Following");
      expect(await view.findByText("Nothing is here yet.")).toBeInTheDocument();
      expect(api.calls("listQuillsPortalMyFeedback").at(-1)?.url).toContain(
        "filter=following",
      );
    });
  });
});
