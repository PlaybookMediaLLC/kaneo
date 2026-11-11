import { and, asc, eq, or, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import { conversationParticipants } from "../../database/quills/schema/conversation";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { isCustomer, realEmail } from "../directory/customer";
import {
  conversationParams,
  errors,
  findConversation,
  notFound,
  systemNotice,
  type ConversationId,
} from "./conversation-model";

// Customers added to a conversation beyond its visitor (group threads). Teammates are never participants.

const participant = z.object({
  principalId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  addedByPrincipalId: z.string().nullable(),
  createdAt: responseTimestamp,
});
const label = sql<
  string | null
>`coalesce(${user.name}, ${principal.displayName})`;

const participantsOf = async (db: Database, conversationId: ConversationId) =>
  (
    await db
      .select({
        principalId: conversationParticipants.principalId,
        name: label,
        accountEmail: user.email,
        contactEmail: principal.contactEmail,
        addedByPrincipalId: conversationParticipants.addedByPrincipalId,
        createdAt: conversationParticipants.createdAt,
      })
      .from(conversationParticipants)
      .innerJoin(
        principal,
        eq(principal.id, conversationParticipants.principalId),
      )
      .leftJoin(user, eq(user.id, principal.userId))
      .where(eq(conversationParticipants.conversationId, conversationId))
      .orderBy(asc(conversationParticipants.createdAt))
      .limit(500)
  ).map(({ accountEmail, contactEmail, ...row }) => ({
    ...row,
    email: realEmail(accountEmail) ?? realEmail(contactEmail),
  }));

const result = z.object({
  conversationId: z.string(),
  principalId: z.string(),
  changed: z.boolean(),
  participants: z.array(participant),
});

const listParticipants = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/participants",
  operationId: "listQuillsConversationParticipants",
  summary: "List the customers added to a conversation",
  description: "Oldest first. Synthetic lead addresses are never shown.",
  action: "read",
  params: conversationParams,
  response: z.object({ items: z.array(participant) }),
  responseDescription: "Participants",
  errors,
  handler: async ({ db, params }) => {
    const conversation = await findConversation(db, params.conversationId);
    return { items: await participantsOf(db, conversation.id) };
  },
});

const addParticipant = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/participants",
  operationId: "addQuillsConversationParticipant",
  summary: "Add a customer to a conversation",
  description:
    "An existing customer of this workspace, by principal ID or by account or contact email (404 otherwise: create the person first). Idempotent; adding the visitor changes nothing. The transcript notice is team-only.",
  action: "update",
  params: conversationParams,
  body: z
    .object({
      principalId: flexibleToTypeIdSchema("principal").optional(),
      email: z.email().max(320).optional(),
    })
    .refine((b) => (b.principalId === undefined) !== (b.email === undefined), {
      message: "Provide exactly one of principalId or email",
    }),
  response: result,
  responseDescription: "The participant list",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "conversation.participant_added",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { principalId: result.principalId },
    },
  handler: async ({ db, actor, params, body }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const email = body.email?.trim().toLowerCase();
    const [person] = await db
      .select({ id: principal.id, name: label })
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          isCustomer,
          body.principalId
            ? eq(principal.id, body.principalId)
            : or(
                sql`lower(${user.email}) = ${email}`,
                sql`lower(${principal.contactEmail}) = ${email}`,
              ),
        ),
      )
      .orderBy(principal.createdAt)
      .limit(1);
    if (!person) throw notFound("Person");
    const added =
      person.id === conversation.visitorPrincipalId
        ? []
        : await db
            .insert(conversationParticipants)
            .values({
              conversationId: conversation.id,
              principalId: person.id,
              addedByPrincipalId: actor.principalId,
            })
            .onConflictDoNothing()
            .returning({ id: conversationParticipants.principalId });
    if (added.length)
      await systemNotice(
        db,
        conversation.id,
        `${person.name ?? "A customer"} was added to the conversation`,
        { internal: true },
      );
    return {
      conversationId: conversation.id,
      principalId: person.id,
      changed: added.length > 0,
      participants: await participantsOf(db, conversation.id),
    };
  },
});

const removeParticipant = defineQuillsRoute({
  method: "delete",
  path: "/conversations/{conversationId}/participants/{principalId}",
  operationId: "removeQuillsConversationParticipant",
  summary: "Remove a customer from a conversation",
  description:
    "Idempotent for a person of this workspace who is not a participant. The transcript notice is team-only.",
  action: "update",
  params: conversationParams.extend({
    principalId: flexibleToTypeIdSchema("principal"),
  }),
  response: result,
  responseDescription: "The participant list",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "conversation.participant_removed",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { principalId: params.principalId },
    },
  handler: async ({ db, params }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const [person] = await db
      .select({ id: principal.id, name: label })
      .from(principal)
      .leftJoin(user, eq(user.id, principal.userId))
      .where(eq(principal.id, params.principalId));
    if (!person) throw notFound("Person");
    const removed = await db
      .delete(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversation.id),
          eq(conversationParticipants.principalId, person.id),
        ),
      )
      .returning({ id: conversationParticipants.principalId });
    if (removed.length)
      await systemNotice(
        db,
        conversation.id,
        `${person.name ?? "A customer"} was removed from the conversation`,
        { internal: true },
      );
    return {
      conversationId: conversation.id,
      principalId: person.id,
      changed: removed.length > 0,
      participants: await participantsOf(db, conversation.id),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listParticipants)
  .openapi(...addParticipant)
  .openapi(...removeParticipant);
