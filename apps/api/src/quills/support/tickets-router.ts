import { apiRouter, type BaseVariables } from "../../openapi";
import channelAccounts from "./channel-accounts";
import macros from "./macros";
import sla from "./sla";
import supportReporting from "./support-reporting";
import { ticketMergeRouter } from "./support-merge";
import supportSettings from "./support-settings";
import ticketExternalLinks from "./ticket-external-links";
import ticketLinks from "./ticket-links";
import ticketPosts from "./ticket-posts";
import ticketReadState from "./ticket-read-state";
import ticketStatuses from "./ticket-statuses";
import ticketThread from "./ticket-thread";
import ticketTypes from "./ticket-types";
import ticketWatchers from "./ticket-watchers";
import tickets from "./tickets";

/** Teammate routes for tickets, macros, SLA, support settings, email channel configuration and reporting. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", ticketMergeRouter)
  .route("/", tickets)
  .route("/", ticketThread)
  .route("/", ticketWatchers)
  .route("/", ticketLinks)
  .route("/", ticketExternalLinks)
  .route("/", ticketPosts)
  .route("/", ticketReadState)
  .route("/", ticketStatuses)
  .route("/", ticketTypes)
  .route("/", macros)
  .route("/", sla)
  .route("/", supportSettings)
  .route("/", channelAccounts)
  .route("/", supportReporting);
