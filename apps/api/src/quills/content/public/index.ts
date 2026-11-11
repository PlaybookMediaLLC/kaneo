import { apiRouter } from "../../../openapi";
import feedback from "./help-center/feedback";
import pages from "./help-center/pages";
import search from "./help-center/search";
import sitemap from "./help-center/sitemap";
import status from "./status/page";
import subscriptions from "./status/subscriptions";

// Public help-center and status routes under /quills-public/{workspace}, mounted from
// ../../public.ts. Each module declares its routes with ../../framework/define-route.
export default apiRouter()
  .route("/", pages)
  .route("/", search)
  .route("/", feedback)
  .route("/", sitemap)
  .route("/", status)
  .route("/", subscriptions);
