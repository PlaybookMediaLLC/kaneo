import { slaEvents } from "../../database/quills/schema/sla";
import { fixture } from "../framework/contract";
import { seedWith } from "./seed.fixture";

/** A met and a breached first-response event on A's ticket. */
export const getQuillsSupportReporting = fixture({
  seed: seedWith(async (db, ids) => {
    await db.insert(slaEvents).values([
      {
        ticketId: ids.ticketId,
        policyId: ids.policyId,
        kind: "first_response_met",
      },
      {
        ticketId: ids.ticketId,
        policyId: ids.policyId,
        kind: "first_response_breached",
      },
    ]);
    return {};
  }),
  valid: () => ({
    query: {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
    },
  }),
});

/** A read of A's conversations; support-reporting.test.ts checks the counts and the filter. */
export const attributeQuillsBreakdown = fixture({
  seed: async () => ({}),
  valid: () => ({
    query: {
      key: "plan",
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(),
    },
  }),
});
