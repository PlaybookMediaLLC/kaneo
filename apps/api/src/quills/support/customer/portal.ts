import { apiRouter } from "../../../openapi";
import { conversationRoutes } from "./conversations";
import csatEmail from "./csat-email";
import { ticketRoutes } from "./tickets";

// Portal support routes under /quills-public/{workspace}/support: the signed-in customer's
// conversations and tickets, and the public CSAT email link.
export default apiRouter()
  .route("/", csatEmail)
  .route("/", conversationRoutes("portal"))
  .route("/", ticketRoutes("portal"));
