import { and, inArray, isNotNull } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import {
  ticketConversations,
  tickets,
} from "../../database/quills/schema/tickets";
import { defineQuillsRoute, type Database } from "../framework/define-route";

// The Test view's "Delete test conversations". Only a thread whose visitor is a test customer
// goes; workspace row security keeps the delete in the caller's workspace.

const testCustomers = (db: Database) =>
  db
    .select({ id: principal.id })
    .from(principal)
    .where(isNotNull(principal.testOwnerPrincipalId));

const deleteTestConversations = defineQuillsRoute({
  method: "delete",
  path: "/test-conversations",
  operationId: "deleteQuillsTestConversations",
  summary: "Delete every test conversation",
  description:
    "Deletes each conversation whose visitor is a teammate's test customer, with its messages, and the pair ticket that the test customer requested. Other conversations and tickets stay; attachment cleanup is queued by the storage triggers.",
  action: "delete",
  response: z.object({ deleted: z.number() }),
  responseDescription: "The number of deleted conversations",
  event: ({ workspaceId }, result) =>
    result.deleted > 0 && {
      type: "conversation.test_deleted",
      entityType: "workspace",
      entityId: workspaceId,
      payload: { count: String(result.deleted) },
    },
  handler: async ({ db }) => {
    const doomed = db
      .select({ id: conversations.id })
      .from(conversations)
      .where(inArray(conversations.visitorPrincipalId, testCustomers(db)));
    // The pair ticket's requester is the same test customer; it goes with its thread, as in the source.
    await db
      .delete(tickets)
      .where(
        and(
          inArray(tickets.requesterPrincipalId, testCustomers(db)),
          inArray(
            tickets.id,
            db
              .select({ id: ticketConversations.ticketId })
              .from(ticketConversations)
              .where(inArray(ticketConversations.conversationId, doomed)),
          ),
        ),
      );
    const rows = await db
      .delete(conversations)
      .where(inArray(conversations.visitorPrincipalId, testCustomers(db)))
      .returning({ id: conversations.id });
    return { deleted: rows.length };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...deleteTestConversations,
);
