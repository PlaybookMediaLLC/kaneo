import { apiRouter } from "../../../openapi";
import { conversationRoutes } from "../../support/customer/conversations";
import { ticketRoutes } from "../../support/customer/tickets";
import { embedRoutes } from "../../support/embeds";
import { customerLinkPreview } from "../../support/link-preview";
import presence from "./presence";

// Widget support routes under /quills-public/{workspace}/widget: the visitor's conversations and
// tickets (widget session Bearer), the public messenger reads and embed preview cards.
export default apiRouter()
  .route("/", presence)
  .route("/", conversationRoutes("widget"))
  .route("/", ticketRoutes("widget"))
  .route("/", embedRoutes("widget"))
  .route("/", customerLinkPreview("widget"));
