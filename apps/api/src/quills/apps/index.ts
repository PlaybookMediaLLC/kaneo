import { apiRouter, type BaseVariables } from "../../openapi";
import boards from "./boards";
import links from "./links";
import posts from "./posts";
import registrations from "./registrations";
import search from "./search";

// Sidebar apps (RFC 0001, lane X1): the app routes under /apps and their teammate management routes.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", boards)
  .route("/", search)
  .route("/", posts)
  .route("/", links)
  .route("/", registrations);
