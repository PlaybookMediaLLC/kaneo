import { and, eq, isNull, ne } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import {
  assigneeInput,
  changedConversation,
  conversationParams,
  endReasons,
  errors,
  findConversation,
  loadConversation,
  priorities,
  statuses,
  type Conversation,
  type ConversationId,
} from "./conversation-model";
import {
  assignAgent,
  assignTeam,
  endConversation,
  requireClosable,
  resolveAssignee,
  resolveTeam,
  restoreFromSpam,
  setPriority,
  setStatus,
  snooze,
} from "./conversation-ops";

/** A state route: lock the row, apply one change, return the conversation with `changed`. */
async function apply(
  db: Database,
  id: ConversationId,
  change: (conversation: Conversation) => Promise<boolean>,
) {
  const conversation = await findConversation(db, id, true);
  const changed = await change(conversation);
  return { ...(await loadConversation(db, conversation.id)), changed };
}

const common = {
  action: "update" as const,
  params: conversationParams,
  response: changedConversation,
  responseDescription: "The conversation and whether it changed",
  errors,
};

const setStatusRoute = defineQuillsRoute({
  ...common,
  method: "post",
  path: "/conversations/{conversationId}/status",
  operationId: "setQuillsConversationStatus",
  summary: "Set a conversation's status",
  description:
    "Closing needs every required attribute filled (409 names the missing ones). `snoozed` means until the customer replies; use the snooze route for a wake time.",
  body: z.object({ status: z.enum(statuses) }),
  event: ({ params, body }, result) =>
    result.changed && {
      type: "conversation.status_changed",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { status: body.status },
    },
  handler: ({ db, params, body }) =>
    apply(db, params.conversationId, async (conversation) => {
      if (body.status === "closed" && conversation.status !== "closed")
        await requireClosable(db, conversation);
      return setStatus(db, conversation, body.status);
    }),
});

const snoozeRoute = defineQuillsRoute({
  ...common,
  method: "post",
  path: "/conversations/{conversationId}/snooze",
  operationId: "snoozeQuillsConversation",
  summary: "Snooze a conversation",
  description:
    "Until a wake time, or until the customer replies (null). The transcript notice is team-only.",
  body: z.object({
    until: z.iso.datetime({ offset: true }).max(64).nullable(),
  }),
  event: ({ params }, result) =>
    result.changed && {
      type: "conversation.status_changed",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { status: "snoozed" },
    },
  handler: ({ db, actor, params, body }) =>
    apply(db, params.conversationId, (conversation) =>
      snooze(db, actor, conversation, body.until ? new Date(body.until) : null),
    ),
});

const endRoute = defineQuillsRoute({
  ...common,
  method: "post",
  path: "/conversations/{conversationId}/end",
  operationId: "endQuillsConversation",
  summary: "End a conversation with a reason",
  description:
    "Closes the conversation. Unless the reason is spam, every required attribute must be filled (409 names the missing ones).",
  body: z.object({
    reason: z.enum(endReasons),
    note: z.string().trim().max(2000).optional(),
  }),
  event: ({ params, body }, result) =>
    result.changed && {
      type: "conversation.status_changed",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { status: "closed", reason: body.reason },
    },
  handler: ({ db, params, body }) =>
    apply(db, params.conversationId, async (conversation) => {
      // Filing spam is never blocked by a required attribute; any other close is.
      if (body.reason !== "spam" && conversation.status !== "closed")
        await requireClosable(db, conversation);
      return endConversation(db, conversation, body.reason, body.note || null);
    }),
});

const restoreSpamRoute = defineQuillsRoute({
  ...common,
  method: "post",
  path: "/conversations/{conversationId}/restore-spam",
  operationId: "restoreQuillsConversationFromSpam",
  summary: "Restore a spam-ended conversation",
  description: "Returns 409 unless the conversation was ended as spam.",
  event: ({ params }, result) =>
    result.changed && {
      type: "conversation.status_changed",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { status: "open" },
    },
  handler: ({ db, params }) =>
    apply(db, params.conversationId, (conversation) =>
      restoreFromSpam(db, conversation),
    ),
});

const priorityRoute = defineQuillsRoute({
  ...common,
  method: "post",
  path: "/conversations/{conversationId}/priority",
  operationId: "setQuillsConversationPriority",
  summary: "Set a conversation's priority",
  body: z.object({ priority: z.enum(priorities) }),
  event: ({ params, body }, result) =>
    result.changed && {
      type: "conversation.priority_changed",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { priority: body.priority },
    },
  handler: ({ db, actor, params, body }) =>
    apply(db, params.conversationId, (conversation) =>
      setPriority(db, actor, conversation, body.priority),
    ),
});

const assignRoute = defineQuillsRoute({
  ...common,
  method: "post",
  path: "/conversations/{conversationId}/assign",
  operationId: "assignQuillsConversation",
  summary: "Assign a conversation to a teammate",
  description:
    "The assignee is `me`, a teammate of a current workspace member, or null to unassign. Never changes the team.",
  body: z.object({ assigneePrincipalId: assigneeInput }),
  event: ({ params, body }, result) =>
    result.changed && {
      type: "conversation.assigned",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: {
        field: "agent",
        cleared: String(body.assigneePrincipalId === null),
      },
    },
  load: ({ workspaceId }) => memberUserIds(workspaceId),
  handler: async ({ db, actor, params, body, loaded: members }) => {
    const assignee = await resolveAssignee(
      db,
      actor,
      members,
      body.assigneePrincipalId,
    );
    return apply(db, params.conversationId, (conversation) =>
      assignAgent(db, actor, conversation, assignee),
    );
  },
});

const teamRoute = defineQuillsRoute({
  ...common,
  method: "put",
  path: "/conversations/{conversationId}/team",
  operationId: "assignQuillsConversationTeam",
  summary: "Assign a conversation to a team",
  description:
    "Null clears the team. Never changes the assigned teammate; automatic distribution to a member is not available yet.",
  body: z.object({ teamId: flexibleToTypeIdSchema("team").nullable() }),
  event: ({ params, body }, result) =>
    result.changed && {
      type: "conversation.assigned",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { field: "team", cleared: String(body.teamId === null) },
    },
  handler: async ({ db, actor, params, body }) => {
    const team = await resolveTeam(db, body.teamId);
    return apply(db, params.conversationId, (conversation) =>
      assignTeam(db, actor, conversation, team),
    );
  },
});

const contactEmailRoute = defineQuillsRoute({
  ...common,
  method: "put",
  path: "/conversations/{conversationId}/contact-email",
  operationId: "captureQuillsVisitorContactEmail",
  summary: "Store a contact email for the conversation's visitor",
  description:
    "Team-only. Never replaces an address already on file, on the visitor or on the conversation.",
  body: z.object({ email: z.email().max(320) }),
  event: ({ params }, result) =>
    result.changed && {
      type: "conversation.updated",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { field: "visitorEmail" },
    },
  handler: ({ db, params, body }) =>
    apply(db, params.conversationId, async (conversation) => {
      const email = body.email.trim().toLowerCase();
      const visitor = await db
        .update(principal)
        .set({ contactEmail: email })
        .where(
          and(
            eq(principal.id, conversation.visitorPrincipalId),
            isNull(principal.contactEmail),
          ),
        )
        .returning({ id: principal.id });
      const row = await db
        .update(conversations)
        .set({ visitorEmail: email, updatedAt: new Date() })
        .where(
          and(
            eq(conversations.id, conversation.id),
            isNull(conversations.visitorEmail),
          ),
        )
        .returning({ id: conversations.id });
      return visitor.length + row.length > 0;
    }),
});

const translationRoute = defineQuillsRoute({
  ...common,
  method: "put",
  path: "/conversations/{conversationId}/translation",
  operationId: "setQuillsInboxTranslationEnabled",
  summary: "Turn inbox translation on or off for a conversation",
  description:
    "Stores the toggle only; message translation needs the AI provider and is not available yet.",
  body: z.object({ enabled: z.boolean() }),
  event: ({ params, body }, result) =>
    result.changed && {
      type: "conversation.updated",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { field: "translation", enabled: String(body.enabled) },
    },
  handler: ({ db, params, body }) =>
    apply(db, params.conversationId, async (conversation) => {
      if (conversation.translationEnabled === body.enabled) return false;
      await db
        .update(conversations)
        .set({
          translationEnabled: body.enabled,
          ...(body.enabled && { translationDismissedAt: null }),
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, conversation.id));
      return true;
    }),
});

const dismissRoute = defineQuillsRoute({
  ...common,
  method: "post",
  path: "/conversations/{conversationId}/translation/dismiss",
  operationId: "dismissQuillsInboxTranslationSuggestion",
  summary: "Dismiss the translation suggestion for a conversation",
  event: ({ params }, result) =>
    result.changed && {
      type: "conversation.updated",
      entityType: "conversation",
      entityId: params.conversationId,
      payload: { field: "translationDismissedAt" },
    },
  handler: ({ db, params }) =>
    apply(db, params.conversationId, async (conversation) => {
      if (conversation.translationDismissedAt) return false;
      await db
        .update(conversations)
        .set({ translationDismissedAt: new Date(), updatedAt: new Date() })
        .where(eq(conversations.id, conversation.id));
      return true;
    }),
});

const availabilityRoute = defineQuillsRoute({
  method: "put",
  path: "/support/availability",
  operationId: "setQuillsAgentAvailability",
  summary: "Set your chat availability",
  description:
    "`away` opts the caller out of chat routing. Always the caller's own.",
  action: "update",
  body: z.object({ availability: z.enum(["online", "away"]) }),
  response: z.object({
    principalId: z.string(),
    availability: z.enum(["online", "away"]),
    changed: z.boolean(),
  }),
  responseDescription: "Availability",
  event: (_input, result) =>
    result.changed && {
      type: "agent.availability_changed",
      entityType: "principal",
      entityId: result.principalId,
      payload: { availability: result.availability },
    },
  handler: async ({ db, actor, body }) => {
    const changed = await db
      .update(principal)
      .set({ chatAvailability: body.availability })
      .where(
        and(
          eq(principal.id, actor.principalId),
          ne(principal.chatAvailability, body.availability),
        ),
      )
      .returning({ id: principal.id });
    return {
      principalId: actor.principalId,
      availability: body.availability,
      changed: changed.length > 0,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...setStatusRoute)
  .openapi(...snoozeRoute)
  .openapi(...endRoute)
  .openapi(...restoreSpamRoute)
  .openapi(...priorityRoute)
  .openapi(...assignRoute)
  .openapi(...teamRoute)
  .openapi(...contactEmailRoute)
  .openapi(...translationRoute)
  .openapi(...dismissRoute)
  .openapi(...availabilityRoute);
