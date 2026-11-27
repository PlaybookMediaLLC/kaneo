import { apiRouter, type BaseVariables } from "../../openapi";
import attributes from "./conversation-attributes";
import bulk from "./conversation-bulk";
import handoff from "./conversation-handoff";
import messages from "./conversation-messages";
import participants from "./conversation-participants";
import posts from "./conversation-posts";
import state from "./conversation-state";
import tags from "./conversation-tags";
import ticket from "./conversation-ticket";
import ipBlocks from "./ip-blocks";
import spamBlocks from "./spam-blocks";
import { conversationMergeRouter } from "./support-merge";
import views from "./conversation-views";
import conversations from "./conversations";
import inbox from "./inbox";

/** Teammate routes for support conversations, messages, state, tags, attributes, views, the inbox and the paired ticket. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  // Static paths first, so /conversations/bulk and /conversations/merge never read as a conversation ID.
  .route("/", bulk)
  .route("/", conversationMergeRouter)
  .route("/", conversations)
  .route("/", handoff)
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
  .route("/", spamBlocks);
