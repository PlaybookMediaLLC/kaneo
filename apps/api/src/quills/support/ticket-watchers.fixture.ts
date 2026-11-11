import { ticketSubscriptions } from "../../database/quills/schema/ticket-subscriptions";
import { fixture } from "../framework/contract";
import { onTicket, seedWith, type Ids } from "./seed.fixture";

const watcher = (ids: Ids) => ({
  params: { ticketId: ids.a.ticketId, principalId: ids.a.teammateId },
});
const foreignWatcher = (ids: Ids) => ({
  ticketId: ids.b.ticketId,
  principalId: ids.b.teammateId,
});

/** The teammate (the caller of each check) already watches A's ticket, muted. */
const watching = seedWith(async (db, ids) => {
  await db.insert(ticketSubscriptions).values({
    ticketId: ids.ticketId,
    principalId: ids.teammateId,
    reason: "manual",
    mutedUntil: new Date(Date.now() + 86400000),
  });
  return {};
});
const onWatched = (extra: object = {}) => ({
  ...onTicket(() => extra),
  seed: watching,
});

export const getQuillsTicketWatchStatus = onTicket();
export const watchQuillsTicket = onTicket();
export const unwatchQuillsTicket = onWatched();
export const muteQuillsTicket = onWatched({ body: { days: 3 } });
export const unmuteQuillsTicket = onWatched();
export const listQuillsTicketWatchers = onWatched();
export const addQuillsTicketWatcher = fixture({
  seed: onTicket().seed,
  valid: watcher,
  foreign: foreignWatcher,
});
export const removeQuillsTicketWatcher = fixture({
  seed: watching,
  valid: watcher,
  foreign: foreignWatcher,
});
