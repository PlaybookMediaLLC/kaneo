import { describeRouteContract } from "@/quills/test/contracts";
import { Route } from "./index";
describeRouteContract({
  Route,
  validSearch: { status: "snoozed", savedView: "view_1" },
});
