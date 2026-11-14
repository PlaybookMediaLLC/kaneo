import { apiRouter, type BaseVariables } from "../../openapi";
import boards from "./boards";
import comments from "./comments";
import insights from "./insights";
import posts from "./posts";
import votes from "./votes";

/** Teammate routes for feedback boards, posts, votes, comments and insights. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", boards)
  .route("/", posts)
  .route("/", votes)
  .route("/", comments)
  .route("/", insights);
