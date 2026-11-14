import { apiRouter } from "../../../openapi";
import { changelogEngagementRoutes } from "../../portal/changelog-engagement";
import { boardRoutes } from "../../portal/feedback/boards";
import { changelogRoutes } from "../../portal/feedback/changelog";
import { commentRoutes } from "../../portal/feedback/comments";
import { postRoutes } from "../../portal/feedback/posts";
import session from "./session";

// Widget versions of the customer feedback routes (audience "widget", under /widget/...). They
// follow the widget's own enabled flag, not the portal flag. Posts and comments are not edited
// or deleted from the widget, as in the source.
export default apiRouter()
  .route("/", session)
  .route("/", boardRoutes("widget"))
  .route("/", postRoutes("widget"))
  .route("/", commentRoutes("widget"))
  .route("/", changelogEngagementRoutes("widget"))
  .route("/", changelogRoutes("widget"));
