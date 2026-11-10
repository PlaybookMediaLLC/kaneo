// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, isNull } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import {
  conversationMessages,
  conversations,
  conversationTagAssignments,
  conversationTags,
} from "../../database/quills/schema/conversation";
import { conversationAttributeDefinitions } from "../../database/quills/schema/conversation-attributes";
import { teams } from "../../database/quills/schema/teams";
import type { Database, QuillsActor } from "../framework/define-route";
import {
  attributeEntries,
  conflict,
  currentTeammates,
  notFound,
  preview,
  principalName,
  systemNotice,
  type Conversation,
  type PrincipalId,
} from "./conversation-model";

// State changes shared by the single-conversation routes and the bulk route. Each one
// writes only inside the request transaction and returns whether anything changed.

type Status = Conversation["status"];
type Priority = Conversation["priority"];
export type Assignee = { id: PrincipalId; name: string | null };
export type Team = { id: TypeId<"team">; name: string };

/** A teammate other than the assignee who triages a snoozed conversation wakes it, as in the source. */
const wakes = (conversation: Conversation, actor: QuillsActor) =>
  conversation.status === "snoozed" &&
  conversation.assignedAgentPrincipalId !== actor.principalId;
const awake = { status: "open" as const, snoozedUntil: null };

async function update(
  db: Database,
  conversation: Conversation,
  set: Partial<typeof conversations.$inferInsert>,
) {
  await db
    .update(conversations)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));
}

/** Open, snoozed (until the customer replies) or closed. Close and reopen post a notice both sides see. */
export async function setStatus(
  db: Database,
  conversation: Conversation,
  status: Status,
) {
  if (status === conversation.status && !conversation.snoozedUntil)
    return false;
  await update(db, conversation, {
    status,
    snoozedUntil: null,
    resolvedAt: status === "closed" ? new Date() : null,
  });
  if (status === "closed" && conversation.status !== "closed")
    await systemNotice(db, conversation.id, "Conversation ended", {
      event: { kind: "chat_ended" },
    });
  if (conversation.status === "closed" && status !== "closed")
    await systemNotice(db, conversation.id, "Conversation reopened", {
      event: { kind: "chat_reopened" },
    });
  return true;
}

/** A teammate close needs every required attribute filled (409 names the missing ones). */
export async function requireClosable(
  db: Database,
  conversation: Conversation,
) {
  const required = await db
    .select({
      key: conversationAttributeDefinitions.key,
      label: conversationAttributeDefinitions.label,
    })
    .from(conversationAttributeDefinitions)
    .where(
      and(
        eq(conversationAttributeDefinitions.requiredToClose, true),
        isNull(conversationAttributeDefinitions.archivedAt),
      ),
    );
  const filled = new Set(
    attributeEntries(conversation.customAttributes)
      .filter(({ value }) =>
        Array.isArray(value)
          ? value.length > 0
          : value !== null && value !== "",
      )
      .map(({ key }) => key),
  );
  const missing = required.filter((attribute) => !filled.has(attribute.key));
  if (missing.length)
    throw conflict(
      `Missing required attributes: ${missing.map((a) => a.label).join(", ")}`,
    );
}

/** Snooze until a time, or until the customer replies (null). The notice is team-only. */
export async function snooze(
  db: Database,
  actor: QuillsActor,
  conversation: Conversation,
  until: Date | null,
) {
  if (
    conversation.status === "snoozed" &&
    conversation.snoozedUntil?.getTime() === until?.getTime()
  )
    return false;
  await update(db, conversation, {
    status: "snoozed",
    snoozedUntil: until,
    resolvedAt: null,
  });
  const name = await principalName(db, actor.principalId);
  await systemNotice(
    db,
    conversation.id,
    until
      ? `${name} snoozed the conversation until ${until.toISOString()}`
      : `${name} snoozed the conversation until the customer replies`,
    { internal: true, event: { kind: "snoozed", agentName: name } },
  );
  return true;
}

export async function endConversation(
  db: Database,
  conversation: Conversation,
  reason: string,
  note: string | null,
) {
  if (
    conversation.status === "closed" &&
    conversation.endReason === reason &&
    conversation.endNote === note
  )
    return false;
  await update(db, conversation, {
    status: "closed",
    snoozedUntil: null,
    resolvedAt: new Date(),
    endReason: reason,
    endNote: note,
    // An agent's own spam filing is manual; any other end clears a stale marker.
    spamReason: reason === "spam" ? "manual" : null,
  });
  if (conversation.status !== "closed")
    await systemNotice(db, conversation.id, "Conversation ended", {
      event: { kind: "chat_ended" },
    });
  return true;
}

export async function restoreFromSpam(
  db: Database,
  conversation: Conversation,
) {
  if (conversation.endReason !== "spam")
    throw conflict("The conversation is not marked as spam");
  await update(db, conversation, {
    status: "open",
    snoozedUntil: null,
    resolvedAt: null,
    endReason: null,
    endNote: null,
    spamReason: null,
  });
  await systemNotice(db, conversation.id, "Conversation restored from spam", {
    internal: true,
  });
  return true;
}

export async function setPriority(
  db: Database,
  actor: QuillsActor,
  conversation: Conversation,
  priority: Priority,
) {
  const wake = wakes(conversation, actor);
  if (priority === conversation.priority && !wake) return false;
  await update(db, conversation, { priority, ...(wake && awake) });
  if (priority !== conversation.priority) {
    const name = await principalName(db, actor.principalId);
    await systemNotice(
      db,
      conversation.id,
      `${name} changed the priority to ${priority}`,
      {
        internal: true,
        event: { kind: "priority_changed", agentName: name },
      },
    );
  }
  return true;
}

/** Null clears it. Never trusts a body ID as membership proof: `resolveAssignee` checks the roster. */
export async function assignAgent(
  db: Database,
  actor: QuillsActor,
  conversation: Conversation,
  assignee: Assignee | null,
) {
  if ((assignee?.id ?? null) === conversation.assignedAgentPrincipalId)
    return false;
  await update(db, conversation, {
    assignedAgentPrincipalId: assignee?.id ?? null,
    ...(wakes(conversation, actor) && awake),
  });
  if (assignee) {
    const name = assignee.name ?? "a teammate";
    await systemNotice(
      db,
      conversation.id,
      `Conversation assigned to ${name}`,
      {
        event: { kind: "assigned", agentName: name },
      },
    );
  }
  return true;
}

/** Independent of the agent: a team assignment never clears or picks the agent. */
export async function assignTeam(
  db: Database,
  actor: QuillsActor,
  conversation: Conversation,
  team: Team | null,
) {
  if ((team?.id ?? null) === conversation.assignedTeamId) return false;
  await update(db, conversation, {
    assignedTeamId: team?.id ?? null,
    ...(wakes(conversation, actor) && awake),
  });
  if (team)
    await systemNotice(
      db,
      conversation.id,
      `Conversation assigned to the ${team.name} team`,
    );
  return true;
}

export async function attachTag(
  db: Database,
  conversation: Conversation,
  tagId: TypeId<"conversation_tag">,
) {
  const added = await db
    .insert(conversationTagAssignments)
    .values({ conversationId: conversation.id, conversationTagId: tagId })
    .onConflictDoNothing()
    .returning({ id: conversationTagAssignments.conversationTagId });
  return added.length > 0;
}

type ContentJson = (typeof conversationMessages.$inferInsert)["contentJson"];

/**
 * A customer-visible agent reply. Replying counts as reading, stops the wait clock,
 * reopens a closed conversation (a snoozed one stays snoozed) and claims an unassigned one.
 * Delivery to the customer is a worker's job (`message.created`); nothing is sent here.
 */
export async function insertReply(
  db: Database,
  actor: QuillsActor,
  conversation: Conversation,
  content: string,
  contentJson: ContentJson = null,
  label = content,
) {
  const [message] = await db
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      principalId: actor.principalId,
      senderType: "agent",
      content,
      contentJson,
    })
    .returning({
      id: conversationMessages.id,
      createdAt: conversationMessages.createdAt,
    });
  const status =
    conversation.status === "closed" ? "open" : conversation.status;
  await db
    .update(conversations)
    .set({
      lastMessageAt: message!.createdAt,
      lastMessagePreview: preview(label),
      agentLastReadAt: message!.createdAt,
      assignedAgentPrincipalId:
        conversation.assignedAgentPrincipalId ?? actor.principalId,
      status,
      waitingSince: null,
      resolvedAt: null,
      updatedAt: message!.createdAt,
    })
    .where(eq(conversations.id, conversation.id));
  return message!.id;
}

/** `me` is the caller. The assignee must be a teammate of a current workspace member. */
export async function resolveAssignee(
  db: Database,
  actor: QuillsActor,
  members: readonly string[],
  value: PrincipalId | "me" | null,
): Promise<Assignee | null> {
  if (value === null) return null;
  const id = value === "me" ? actor.principalId : value;
  const [teammate] = await currentTeammates(db, members, [id]);
  if (!teammate) throw notFound("Teammate");
  return teammate;
}

export async function resolveTeam(
  db: Database,
  id: TypeId<"team"> | null,
): Promise<Team | null> {
  if (id === null) return null;
  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, id), isNull(teams.deletedAt)));
  if (!team) throw notFound("Team");
  return team;
}

export async function resolveLiveTag(
  db: Database,
  id: TypeId<"conversation_tag">,
) {
  const [tag] = await db
    .select({ id: conversationTags.id })
    .from(conversationTags)
    .where(
      and(eq(conversationTags.id, id), isNull(conversationTags.deletedAt)),
    );
  if (!tag) throw notFound("Tag");
  return tag.id;
}
