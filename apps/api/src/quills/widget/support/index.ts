import { apiRouter } from "../../../openapi";
import { conversationRoutes } from "../../support/customer/conversations";
import { ticketRoutes } from "../../support/customer/tickets";
import presence from "./presence";

// Widget support routes under /quills-public/{workspace}/widget: the visitor's conversations and
// tickets (widget session Bearer), and the public messenger reads.
export default apiRouter()
  .route("/", presence)
  .route("/", conversationRoutes("widget"))
  .route("/", ticketRoutes("widget"));
