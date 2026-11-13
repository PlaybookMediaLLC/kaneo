import { describe, expect, it } from "vite-plus/test";
import { getCustomerProfileFixture } from "../../api/portal/get-customer-profile.fixture";
import { getPublicUserProfileFixture } from "../../api/portal/get-public-user-profile.fixture";
import { updateCustomerProfileFixture } from "../../api/portal/update-customer-profile.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { ProfilePage } from "./profile-page";

describe("ProfilePage", () => {
  const signedIn = { viewer: { kind: "user" as const, id: "account_test_1" } };
  describePageContract(meta, ProfilePage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return signedIn;
      },
    },
    notFound: {
      prepare: () => {
        mockApi().reply({ message: "Missing" }, 404);
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
        mockApi().reply(
          getCustomerProfileFixture.ok({ principalId: null, name: "Ada" }),
        );
        return signedIn;
      },
      assert: async (view) => {
        expect(await view.findByLabelText("Display name")).toHaveValue("Ada");
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(
          getCustomerProfileFixture.ok({ principalId: null, name: "Ada" }),
        );
        api.reply(updateCustomerProfileFixture.ok({ name: "Grace" }));
        api.reply(
          getCustomerProfileFixture.ok({ principalId: null, name: "Grace" }),
        );
        return signedIn;
      },
      act: async (view) => {
        await view.findByLabelText("Display name");
        fill("Display name", "Grace");
        press("Save profile");
      },
      assert: async (view) => {
        await view.findByDisplayValue("Grace");
      },
    },
  });
  describe("behavior", () => {
    it("combines the caller account identity with its public portal activity", async () => {
      const api = mockApi();
      api.reply(
        getCustomerProfileFixture.ok({
          linked: true,
          principalId: "principal_test_1",
          name: "Ada",
          email: "ada@example.test",
        }),
      );
      api.reply(
        getPublicUserProfileFixture.ok({
          principalId: "principal_test_1",
          postCount: 2,
        }),
      );
      const view = renderPage(ProfilePage, meta, {
        viewer: { kind: "user", id: "account_test_1" },
      });
      expect(
        await view.findByText("ada@example.test", { exact: false }),
      ).toBeInTheDocument();
      expect(await view.findByText("Submitted 2 posts")).toBeInTheDocument();
      expect(api.calls("getQuillsPublicUserProfile")).toHaveLength(1);
    });
  });
});
