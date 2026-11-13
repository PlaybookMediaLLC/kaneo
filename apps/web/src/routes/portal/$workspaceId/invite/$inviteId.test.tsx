import { expect, it } from "vite-plus/test";
import { takeStashedToken } from "@/quills/core/token-stash";
import { describeRouteContract } from "@/quills/test/contracts";
import { Route } from "./$inviteId";

describeRouteContract(Route);

it("removes and persists the fragment token before rendering", () => {
  window.history.replaceState(
    {},
    "",
    "/portal/workspace_test_1/invite/invite_test_1#token=mail_link_value",
  );
  Route.options.beforeLoad?.({
    params: { workspaceId: "workspace_test_1", inviteId: "invite_test_1" },
  } as never);
  expect(window.location.hash).toBe("");
  expect(takeStashedToken("workspace_test_1:invite_test_1:invite")).toBe(
    "mail_link_value",
  );
});
