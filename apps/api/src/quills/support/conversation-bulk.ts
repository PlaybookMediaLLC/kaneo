import { asc, eq, inArray } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { conversations } from "../../database/quills/schema/conversation";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import {
  conflict,
  errors,
  notFound,
  priorities,
  type Conversation,
} from "./conversation-model";
import {
  assignAgent,
  assignTeam,
  attachTag,
  requireClosable,
  resolveAssignee,
  resolveLiveTag,
  resolveTeam,
  restoreFromSpam,
  setPriority,
  setStatus,
  snooze,
} from "./conversation-ops";
import { assigneeInput } from "./conversation-state";

// All or nothing: the request is one transaction, so a missing ID, a blocked close or an
// invalid target throws and rolls back every conversation of the batch.

const ids = z
  .array(flexibleToTypeIdSchema("conversation"))
  .min(1)
  .max(100)
  .refine(
    (list) => new Set(list).size === list.length,
    "Each ID can appear only once",
  );

/** Every conversation of the batch, locked in ID order so parallel batches cannot deadlock. 404 if one is missing. */
async function lockAll(db: Database, list: TypeId<"conversation">[]) {
  const rows = await db
    .select()
    .from(conversations)
    .where(inArray(conversations.id, list))
    .orderBy(asc(conversations.id))
    .for("update");
  if (rows.length !== list.length) throw notFound("Conversation");
  return rows;
}

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assign"), assigneePrincipalId: assigneeInput }),
  z.object({
    type: z.literal("assign_team"),
    teamId: flexibleToTypeIdSchema("team").nullable(),
  }),
  z.object({ type: z.literal("priority"), priority: z.enum(priorities) }),
  z.object({
    type: z.literal("snooze"),
    until: z.iso.datetime({ offset: true }).nullable(),
  }),
  z.object({
    type: z.literal("tag"),
    tagId: flexibleToTypeIdSchema("conversation_tag"),
  }),
  z.object({ type: z.literal("close") }),
  z.object({ type: z.literal("reopen") }),
  z.object({ type: z.literal("restore_spam") }),
]);

const result = z.object({
  action: z.string(),
  firstId: z.string(),
  count: z.number(),
  changedIds: z.array(z.string()),
});

const bulkUpdate = defineQuillsRoute({
  method: "post",
  path: "/conversations/bulk",
  operationId: "bulkQuillsUpdateConversations",
  summary: "Apply one action to many conversations",
  description:
    "Up to 100 conversations. All or nothing: one missing conversation, invalid target, blocked close (required attributes) or non-spam restore returns 404 or 409 and changes nothing.",
  action: "update",
  body: z.object({ conversationIds: ids, action }),
  response: result,
  responseDescription: "The conversations that changed",
  errors,
  event: (_input, result) =>
    result.changedIds.length > 0 && {
      type: "conversation.bulk_updated",
      entityType: "conversation",
      entityId: result.firstId,
      payload: {
        action: result.action,
        count: String(result.changedIds.length),
      },
    },
  load: ({ workspaceId }) => memberUserIds(workspaceId),
  handler: async ({ db, actor, body, loaded: members }) => {
    const step = body.action;
    // Targets are checked once, before any write.
    let apply: (conversation: Conversation) => Promise<boolean>;
    switch (step.type) {
      case "assign": {
        const assignee = await resolveAssignee(
          db,
          actor,
          members,
          step.assigneePrincipalId,
        );
        apply = (c) => assignAgent(db, actor, c, assignee);
        break;
      }
      case "assign_team": {
        const team = await resolveTeam(db, step.teamId);
        apply = (c) => assignTeam(db, actor, c, team);
        break;
      }
      case "priority":
        apply = (c) => setPriority(db, actor, c, step.priority);
        break;
      case "snooze": {
        const until = step.until ? new Date(step.until) : null;
        apply = (c) => snooze(db, actor, c, until);
        break;
      }
      case "tag": {
        const tagId = await resolveLiveTag(db, step.tagId);
        apply = (c) => attachTag(db, c, tagId);
        break;
      }
      case "close":
        apply = async (c) => {
          if (c.status !== "closed") await requireClosable(db, c);
          return setStatus(db, c, "closed");
        };
        break;
      case "reopen":
        apply = (c) => setStatus(db, c, "open");
        break;
      case "restore_spam":
        apply = (c) => restoreFromSpam(db, c);
        break;
    }
    const changedIds: string[] = [];
    for (const conversation of await lockAll(db, body.conversationIds))
      if (await apply(conversation)) changedIds.push(conversation.id);
    return {
      action: step.type,
      firstId: body.conversationIds[0]!,
      count: body.conversationIds.length,
      changedIds,
    };
  },
});

const bulkDelete = defineQuillsRoute({
  method: "post",
  path: "/conversations/bulk-delete",
  operationId: "bulkQuillsDeleteConversations",
  summary: "Delete spam-ended conversations for good",
  description:
    "Up to 100. Every conversation must be ended as spam (409 otherwise) and nothing is deleted then. Messages, tags, participants and summaries go with them; attachment cleanup is queued by the storage triggers.",
  action: "delete",
  body: z.object({ conversationIds: ids }),
  response: z.object({ firstId: z.string(), deletedIds: z.array(z.string()) }),
  responseDescription: "Deleted conversations",
  errors,
  event: (_input, result) => ({
    type: "conversation.deleted",
    entityType: "conversation",
    entityId: result.firstId,
    payload: { count: String(result.deletedIds.length) },
  }),
  handler: async ({ db, body }) => {
    const rows = await lockAll(db, body.conversationIds);
    if (rows.some((row) => row.endReason !== "spam" || row.status !== "closed"))
      throw conflict("Only conversations ended as spam can be deleted");
    for (const row of rows)
      await db.delete(conversations).where(eq(conversations.id, row.id));
    return {
      firstId: body.conversationIds[0]!,
      deletedIds: rows.map((row) => row.id),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...bulkUpdate)
  .openapi(...bulkDelete);
