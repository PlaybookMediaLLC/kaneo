import { apiRouter } from "../../../openapi";
import { conversationRoutes } from "./conversations";
import csatEmail from "./csat-email";
import magicLink from "./magic-link";
import { ticketRoutes } from "./tickets";
import { embedRoutes } from "../embeds";
import { customerLinkPreview } from "../link-preview";
import { portalPresenceRoutes } from "../presence";

// Portal support routes under /quills-public/{workspace}/support: the signed-in customer's
// conversations and tickets, the team's availability, embed preview cards (under /portal), the
// public CSAT email link, and single-request signed magic links (#313).
export default apiRouter()
  .route("/", csatEmail)
  .route("/", magicLink)
  .route("/", conversationRoutes("portal"))
  .route("/", ticketRoutes("portal"))
  .route("/", portalPresenceRoutes)
  .route("/", embedRoutes("portal"))
  .route("/", customerLinkPreview("portal"));
