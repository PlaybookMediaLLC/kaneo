import { asc, isNull, sql } from "drizzle-orm";
import { ticketStatuses } from "../../database/quills/schema/tickets";
import { fixture } from "../framework/contract";
import { seed, seedWith, type Ids } from "./seed.fixture";

const all = fixture({ seed, valid: () => ({}) });
/** An unused open status in each workspace, plus every live status ID in order. */
const extraStatus = seedWith(async (db) => {
  const [spare] = await db
    .insert(ticketStatuses)
    .values({
      name: "Spare",
      slug: sql`'spare_' || gen_random_uuid()`,
      category: "open",
      position: 99,
    })
    .returning({ id: ticketStatuses.id });
  const live = await db
    .select({ id: ticketStatuses.id })
    .from(ticketStatuses)
    .where(isNull(ticketStatuses.deletedAt))
    .orderBy(asc(ticketStatuses.position), asc(ticketStatuses.id));
  return { spareStatusId: spare!.id, liveStatusIds: live.map((r) => r.id) };
});
type Extra = Awaited<ReturnType<typeof extraStatus>>;

export const listQuillsTicketStatuses = all;
export const createQuillsTicketStatus = fixture({
  seed,
  valid: () => ({
    body: {
      name: "Blocked",
      color: "#ff0000",
      category: "pending",
      publicStage: "in_progress",
    },
  }),
});
export const updateQuillsTicketStatus = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { statusId: a.otherStatusId },
    body: { name: "Looking" },
  }),
  foreign: ({ b }: Ids) => ({ statusId: b.otherStatusId }),
});
export const deleteQuillsTicketStatus = fixture({
  seed: extraStatus,
  valid: ({ a }: Extra) => ({ params: { statusId: a.spareStatusId } }),
  foreign: ({ b }: Extra) => ({ statusId: b.spareStatusId }),
});
export const reorderQuillsTicketStatuses = fixture({
  seed: extraStatus,
  valid: ({ a }: Extra) => ({
    body: { statusIds: [...a.liveStatusIds].reverse() },
  }),
});
export const getQuillsTicketStageLabels = all;
export const setQuillsTicketStageLabels = fixture({
  seed,
  valid: () => ({ body: { received: "Got it" } }),
});
