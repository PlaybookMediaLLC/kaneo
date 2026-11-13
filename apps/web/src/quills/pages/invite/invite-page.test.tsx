import { describe, expect, it, vi } from "vite-plus/test";
import { acceptPortalInviteFixture } from "../../api/portal/accept-portal-invite.fixture";
import { stashToken } from "../../core/token-stash";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { InvitePage } from "./invite-page";

const scope = "workspace_test_1:invite_test_1:invite";
const options = {
  params: { workspaceId: "workspace_test_1", inviteId: "invite_test_1" },
};

describe("InvitePage", () => {
  const signedIn = {
    ...options,
    viewer: { kind: "user" as const, id: "user_test_1" },
  };
  const pressAccept = async (view: ReturnType<typeof renderPage>) => {
    await view.findByRole("button", { name: "Accept invitation" });
    press("Accept invitation");
  };
  describePageContract(meta, InvitePage, {
    loading: {
      prepare: () => {
        stashToken(scope, "mail_link_value", true);
        mockApi().defer(() => undefined);
        return signedIn;
      },
      act: pressAccept,
    },
    gone: {
      prepare: () => signedIn,
    },
    failed: {
      prepare: () => {
        stashToken(scope, "mail_link_value", true);
        mockApi().fail();
        return signedIn;
      },
      act: pressAccept,
    },
    ready: {
      prepare: () => {
        stashToken(scope, "mail_link_value", true);
        return signedIn;
      },
      assert: async (view) => {
        await view.findByRole("button", { name: "Accept invitation" });
      },
    },
    done: {
      prepare: () => {
        stashToken(scope, "mail_link_value", true);
        mockApi().reply(acceptPortalInviteFixture.ok());
        return signedIn;
      },
      act: pressAccept,
      assert: async (view) => {
        await view.findByText("Invitation accepted");
      },
    },
  });

  describe("behavior", () => {
    it("keeps the fragment token for sign-in and returns to the invite path", () => {
      const api = mockApi();
      stashToken(scope, "mail_link_value", true);
      const view = renderPage(InvitePage, meta, options);
      const signIn = view.getByRole("link", { name: "Sign in" });
      expect(signIn).toHaveAttribute(
        "href",
        "/auth/sign-in?redirect=%2Fportal%2Fworkspace_test_1%2Finvite%2Finvite_test_1",
      );
      expect(signIn.getAttribute("href")).not.toContain("mail_link_value");
      expect(localStorage.getItem(`quills-link-token:${scope}`)).not.toBeNull();
      expect(api.calls()).toHaveLength(0);
    });

    it("recovers the token after sign-in and accepts only after confirmation", async () => {
      const api = mockApi();
      api.reply(acceptPortalInviteFixture.ok());
      stashToken(scope, "mail_link_value", true);
      const view = renderPage(InvitePage, meta, {
        ...options,
        viewer: { kind: "user", id: "user_test_1" },
      });
      expect(api.calls()).toHaveLength(0);
      press("Accept invitation");
      expect(await view.findByText("Invitation accepted")).toBeInTheDocument();
      expect(api.calls("acceptQuillsPortalInvite")).toHaveLength(1);
      expect(
        await api.calls("acceptQuillsPortalInvite")[0].clone().json(),
      ).toEqual({ token: "mail_link_value" });
      expect(localStorage.getItem(`quills-link-token:${scope}`)).toBeNull();
    });

    it("shows a missing token as gone after sign-in", () => {
      const api = mockApi();
      const view = renderPage(InvitePage, meta, {
        ...options,
        viewer: { kind: "user", id: "user_test_1" },
      });
      expect(
        view.getByText(
          "This link is no longer valid. Open the latest email and try again.",
        ),
      ).toBeInTheDocument();
      expect(api.calls()).toHaveLength(0);
    });

    it("refuses confirmation inside a frame", async () => {
      const api = mockApi();
      stashToken(scope, "mail_link_value", true);
      vi.stubGlobal("top", {});
      const view = renderPage(InvitePage, meta, {
        ...options,
        viewer: { kind: "user", id: "user_test_1" },
      });
      press("Accept invitation");
      expect(
        await view.findByText("Open this page in a new tab to continue."),
      ).toBeInTheDocument();
      expect(api.calls()).toHaveLength(0);
      vi.unstubAllGlobals();
    });
  });
});
