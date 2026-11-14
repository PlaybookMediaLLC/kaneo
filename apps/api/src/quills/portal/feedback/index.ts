import { apiRouter } from "../../../openapi";
import { boardRoutes, taxonomyRoutes } from "./boards";
import { changelogEngagementRoutes } from "../changelog-engagement";
import { changelogRoutes } from "./changelog";
import { commentRoutes, ownCommentRoutes } from "./comments";
import feeds from "./feeds";
import { ownPostRoutes, postRoutes } from "./posts";
import attachments from "./attachment-routes";
import roadmaps from "./roadmaps";

// Portal feedback routes and the public feeds under /quills-public/{workspace}. The widget
// mounts the same shared factories with audience "widget" in ../../widget/feedback.
export default apiRouter()
  .route("/", boardRoutes("portal"))
  .route("/", taxonomyRoutes)
  .route("/", postRoutes("portal"))
  .route("/", ownPostRoutes)
  .route("/", commentRoutes("portal"))
  .route("/", ownCommentRoutes)
  .route("/", attachments)
  .route("/", roadmaps)
  .route("/", changelogEngagementRoutes("portal"))
  .route("/", changelogRoutes("portal"))
  .route("/", feeds);
