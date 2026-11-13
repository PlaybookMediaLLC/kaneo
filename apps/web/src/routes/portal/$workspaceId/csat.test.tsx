import { expect, it } from "vite-plus/test";
import { takeStashedToken } from "@/quills/core/token-stash";
import { describeRouteContract } from "@/quills/test/contracts";
import { Route } from "./csat";

describeRouteContract(Route);

it("removes the query token and keeps the selected rating", () => {
  window.history.replaceState(
    {},
    "",
    "/portal/workspace_test_1/csat?token=mail_link_value&rating=4",
  );
  Route.options.beforeLoad?.({
    params: { workspaceId: "workspace_test_1" },
  } as never);
  expect(window.location.search).toBe("?rating=4");
  expect(takeStashedToken("workspace_test_1:csat")).toBe("mail_link_value");
});
