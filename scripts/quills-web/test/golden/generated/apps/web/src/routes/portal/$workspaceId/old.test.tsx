import { describeRedirectContract } from "@/quills/test/contracts";
import { Route } from "./old";
describeRedirectContract({
  Route,
  params: { workspaceId: "workspace_test_1" },
  expectedTo: "/portal/$workspaceId/sample",
});
