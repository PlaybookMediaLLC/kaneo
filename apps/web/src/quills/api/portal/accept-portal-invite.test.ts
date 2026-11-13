import { describe, expect, it } from "vite-plus/test";
import { describeOperationContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { acceptPortalInvite } from "./accept-portal-invite";
import { acceptPortalInviteFixture } from "./accept-portal-invite.fixture";
describe("acceptPortalInvite", () => {
  describeOperationContract({
    operationId: "acceptQuillsPortalInvite",
    operation: acceptPortalInvite,
    request: {
      param: { workspace: "workspace_test_1", inviteId: "invite-id_test_1" },
      json: { token: "mail_link_value" },
    },
    response: acceptPortalInviteFixture.ok(),
    method: "post",
    path: "/api/quills-public/workspace_test_1/portal/invites/invite-id_test_1/accept",
    statuses: [401, 403, 429],
  });

  it("maps an expired invite to gone", async () => {
    const api = mockApi();
    api.reply({ message: "Request could not be completed" }, 409);
    await expect(
      acceptPortalInvite({
        param: {
          workspace: "workspace_test_1",
          inviteId: "invite-id_test_1",
        },
        json: { token: "mail_link_value" },
      }),
    ).rejects.toEqual({ kind: "gone" });
  });
});
