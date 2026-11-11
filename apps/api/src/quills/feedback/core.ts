import { apiRouter, type BaseVariables } from "../../openapi";
import boards from "./boards";
import comments from "./comments";
import posts from "./posts";
import votes from "./votes";

/** Teammate routes for feedback boards, posts, votes and comments. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", boards)
  .route("/", posts)
  .route("/", votes)
  .route("/", comments);
