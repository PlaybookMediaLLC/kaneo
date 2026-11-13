import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { quillsOperationKey } from "../../api/keys";
import { acceptPortalInviteFixture } from "../../api/portal/accept-portal-invite.fixture";
import { useAcceptPortalInvite } from "./use-accept-portal-invite";
describe("useAcceptPortalInvite", () => {
  describeHookContract({
    kind: "mutation",
    hook: useAcceptPortalInvite,
    operationId: "acceptQuillsPortalInvite",
    request: {
      param: { workspace: "workspace_test_1", inviteId: "invite-id_test_1" },
      json: { token: "mail_link_value" },
    },
    response: acceptPortalInviteFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: true,
    invalidates: [
      quillsOperationKey(
        "workspace_test_1",
        { kind: "anonymous" },
        "portal",
        "acceptPortalInvite",
      ),
    ],
  });
});
