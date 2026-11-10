import { apiRouter, type BaseVariables } from "../../openapi";
import channelAccounts from "./channel-accounts";
import macros from "./macros";
import sla from "./sla";
import supportReporting from "./support-reporting";
import supportSettings from "./support-settings";
import ticketLinks from "./ticket-links";
import ticketReadState from "./ticket-read-state";
import ticketStatuses from "./ticket-statuses";
import ticketThread from "./ticket-thread";
import ticketTypes from "./ticket-types";
import ticketWatchers from "./ticket-watchers";
import tickets from "./tickets";

/** Teammate routes for tickets, macros, SLA, support settings, email channel configuration and reporting. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", tickets)
  .route("/", ticketThread)
  .route("/", ticketWatchers)
  .route("/", ticketLinks)
  .route("/", ticketReadState)
  .route("/", ticketStatuses)
  .route("/", ticketTypes)
  .route("/", macros)
  .route("/", sla)
  .route("/", supportSettings)
  .route("/", channelAccounts)
  .route("/", supportReporting);
