import { apiRouter, type BaseVariables } from "../../openapi";
import attributes from "./conversation-attributes";
import bulk from "./conversation-bulk";
import messages from "./conversation-messages";
import participants from "./conversation-participants";
import posts from "./conversation-posts";
import state from "./conversation-state";
import tags from "./conversation-tags";
import views from "./conversation-views";
import conversations from "./conversations";
import inbox from "./inbox";

/** Teammate routes for support conversations, messages, state, tags, attributes, views and the inbox. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  // Static paths first, so /conversations/bulk never reads as a conversation ID.
  .route("/", bulk)
  .route("/", conversations)
  .route("/", messages)
  .route("/", state)
  .route("/", tags)
  .route("/", attributes)
  .route("/", participants)
  .route("/", views)
  .route("/", inbox)
  .route("/", posts);
