import { apiRouter, type BaseVariables } from "../../openapi";
import boards from "./boards";
import comments from "./comments";
import hygiene from "./hygiene";
import insights from "./insights";
import posts from "./posts";
import signals from "./signals";
import votes from "./votes";

/** Teammate routes for feedback boards, posts, hygiene, votes, comments, insights and signals. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", boards)
  .route("/", hygiene)
  .route("/", posts)
  .route("/", votes)
  .route("/", comments)
  .route("/", insights)
  .route("/", signals);
