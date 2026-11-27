import { apiRouter, type BaseVariables } from "../../openapi";
import attributes from "./conversation-attributes";
import bulk from "./conversation-bulk";
import messages from "./conversation-messages";
import participants from "./conversation-participants";
import posts from "./conversation-posts";
import state from "./conversation-state";
import tags from "./conversation-tags";
import ticket from "./conversation-ticket";
import ipBlocks from "./ip-blocks";
import views from "./conversation-views";
import conversations from "./conversations";
import inbox from "./inbox";
import requestAccessLinks from "./request-access-links";
import threadPresence from "./thread-presence";

/** Teammate routes for support conversations, messages, state, tags, attributes, views, the inbox and the paired ticket. */
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
  .route("/", posts)
  .route("/", ticket)
  .route("/", ipBlocks)
  .route("/", requestAccessLinks)
  .route("/", threadPresence);
