import { eq, isNotNull, sql } from "drizzle-orm";
import { withQuillsWorkspace } from "../../database/quills/client";
import { principal, user } from "../../database/quills/schema/auth";
import {
  conversationMessageReactions,
  conversationMessages,
  conversationParticipants,
  conversations,
  conversationTagAssignments,
  conversationTags,
} from "../../database/quills/schema/conversation";
import { conversationAttributeDefinitions } from "../../database/quills/schema/conversation-attributes";
import { conversationViews } from "../../database/quills/schema/conversation-views";
import { teams } from "../../database/quills/schema/teams";
import {
  fixture,
  type ContractEnv,
  type ContractInput,
} from "../framework/contract";
import { side as feedbackSide } from "../feedback/seed.fixture";

// Seed helpers for the support fixtures and feature tests. Not fixtures themselves.

type Db = Parameters<Parameters<ContractEnv["scoped"]>[1]>[0];

/** A customer with an account in one workspace. `test` makes it that teammate's test customer. */
export async function customer(db: Db, email: string, test?: string) {
  const [identity] = await db
    .insert(user)
    .values({ name: "Support Customer", email })
    .returning({ id: user.id });
  const [row] = await db
    .insert(principal)
    .values({
      userId: identity!.id,
      role: "user",
      type: "user",
      displayName: "Support Customer",
      testOwnerPrincipalId: test as never,
      createdAt: new Date(),
    })
    .returning({ id: principal.id });
  return row!.id;
}

/** An open conversation with a visitor message, an agent reply and an internal note. */
export async function conversation(
  db: Db,
  actorId: string,
  visitorId: string,
  values: Partial<typeof conversations.$inferInsert> = {},
) {
  const [row] = await db
    .insert(conversations)
    .values({
      visitorPrincipalId: visitorId as never,
      channel: "messenger",
      subject: "Support contract",
      ...values,
    })
    .returning({ id: conversations.id });
  const id = row!.id;
  const [visitorMessage, agentMessage, note] = await db
    .insert(conversationMessages)
    .values([
      {
        conversationId: id,
        principalId: visitorId as never,
        senderType: "visitor",
        content: "Help",
      },
      {
        conversationId: id,
        principalId: actorId as never,
        senderType: "agent",
        content: "On it",
      },
      {
        conversationId: id,
        principalId: actorId as never,
        senderType: "agent",
        content: "Private context",
        isInternal: true,
      },
    ])
    .returning({ id: conversationMessages.id });
  // The team read everything so far, so "mark unread" has a mark to move back.
  await db
    .update(conversations)
    .set({ agentLastReadAt: sql`now() + interval '1 second'` })
    .where(eq(conversations.id, id));
  return {
    conversationId: id,
    visitorMessageId: visitorMessage!.id,
    agentMessageId: agentMessage!.id,
    noteId: note!.id,
  };
}

/**
 * Optional rows. Each fixture seeds only what its route reads: every seed runs several
 * times per route, and rows in tables without a principal index slow a later workspace delete.
 */
export type Part =
  | "posts"
  | "spam"
  | "participants"
  | "tags"
  | "team"
  | "attributes"
  | "view"
  | "own";

/** One workspace: a conversation with its messages, and the requested parts ("" when not seeded). */
export async function supportSide(
  env: ContractEnv,
  workspaceId: string,
  parts: readonly Part[] = [],
) {
  const has = (part: Part) => parts.includes(part);
  const feedback = has("posts")
    ? await feedbackSide(env, workspaceId)
    : { boardId: "", postId: "" };
  return env.scoped(workspaceId, async (db, actor) => {
    const email = () => `${env.id("customer")}@example.test`;
    const visitorId = await customer(db, email());
    const thread = await conversation(db, actor.principalId, visitorId);
    const side = {
      ...thread,
      visitorId,
      teammateId: actor.principalId,
      spamId: "",
      otherCustomerId: "",
      participantId: "",
      tagId: "",
      archivedTagId: "",
      freeTagId: "",
      newTagName: env.id("newtag"),
      teamId: "",
      attributeId: "",
      archivedAttributeId: "",
      attributeKey: "",
      newAttributeKey: env.id("newattr"),
      viewId: "",
      viewName: env.id("view"),
      boardId: feedback.boardId,
      postId: feedback.postId,
    };
    if (has("spam"))
      side.spamId = (
        await conversation(db, actor.principalId, visitorId, {
          status: "closed",
          endReason: "spam",
          spamReason: "manual",
          resolvedAt: new Date(),
        })
      ).conversationId;
    if (has("participants")) {
      side.otherCustomerId = await customer(db, email());
      side.participantId = await customer(db, email());
      await db.insert(conversationParticipants).values({
        conversationId: thread.conversationId,
        principalId: side.participantId as never,
      });
    }
    if (has("tags")) {
      const [tag, archivedTag, freeTag] = await db
        .insert(conversationTags)
        .values([
          { name: env.id("ctag") },
          { name: env.id("ctag"), deletedAt: new Date() },
          { name: env.id("ctag") },
        ])
        .returning({ id: conversationTags.id });
      await db.insert(conversationTagAssignments).values({
        conversationId: thread.conversationId,
        conversationTagId: tag!.id,
      });
      side.tagId = tag!.id;
      side.archivedTagId = archivedTag!.id;
      side.freeTagId = freeTag!.id;
    }
    if (has("team"))
      side.teamId = (
        await db
          .insert(teams)
          .values({ name: env.id("team") })
          .returning({ id: teams.id })
      )[0]!.id;
    if (has("attributes")) {
      side.attributeKey = env.id("attr");
      const [attribute, archived] = await db
        .insert(conversationAttributeDefinitions)
        .values([
          {
            key: side.attributeKey,
            label: "Reason",
            fieldType: "select",
            options: [{ id: "opt_billing", label: "Billing" }],
          },
          {
            key: env.id("attr"),
            label: "Old",
            fieldType: "text",
            archivedAt: new Date(),
          },
        ])
        .returning({ id: conversationAttributeDefinitions.id });
      side.attributeId = attribute!.id;
      side.archivedAttributeId = archived!.id;
    }
    if (has("view"))
      side.viewId = (
        await db
          .insert(conversationViews)
          .values({
            name: env.id("view"),
            filters: { rules: [{ field: "status", value: "open" }] },
            createdByPrincipalId: actor.principalId,
          })
          .returning({ id: conversationViews.id })
      )[0]!.id;
    return side;
  });
}

/** Both workspaces with the requested parts. `own` adds, in A, an agent message by the caller. */
export const seeded =
  (...parts: Part[]) =>
  async (env: ContractEnv, caller: string) => {
    const ids = {
      a: await supportSide(env, env.a, parts),
      b: await supportSide(env, env.b, parts),
      ownMessageId: "",
    };
    if (parts.includes("own"))
      // The caller's actor is provisioned the way a request would provision it.
      ids.ownMessageId = await withQuillsWorkspace(
        { workspaceId: env.a, userId: caller },
        async (db, actor) => {
          await db
            .update(principal)
            .set({ chatAvailability: "online" })
            .where(eq(principal.id, actor.principalId));
          const [row] = await db
            .insert(conversationMessages)
            .values({
              conversationId: ids.a.conversationId,
              principalId: actor.principalId,
              senderType: "agent",
              content: "Mine",
            })
            .returning({ id: conversationMessages.id });
          return row!.id;
        },
      );
    return ids;
  };
export const seed = seeded();
export type Ids = Awaited<ReturnType<typeof seed>>;

/** A request on A's conversation, with extra input and the workspace B values for its IDs. */
export const onConversation = (
  extra: (ids: Ids) => Omit<ContractInput, "params"> = () => ({}),
  more: (ids: Ids) => Record<string, string> = () => ({}),
  parts: Part[] = [],
) =>
  fixture({
    seed: seeded(...parts),
    valid: (ids: Ids) => ({
      params: { conversationId: ids.a.conversationId },
      ...extra(ids),
    }),
    foreign: (ids: Ids) => ({
      conversationId: ids.b.conversationId,
      ...more(ids),
    }),
  });
export const all = fixture({ seed, valid: () => ({}) });

/** A 👍 from every teammate of A on the visitor message, so the caller has one to remove. */
export const withReactions = async (env: ContractEnv, caller: string) => {
  const ids = await seed(env, caller);
  await env.scoped(env.a, async (db) => {
    const teammates = await db
      .select({ id: principal.id })
      .from(principal)
      .where(isNotNull(principal.kaneoUserId));
    await db.insert(conversationMessageReactions).values(
      teammates.map((t) => ({
        conversationMessageId: ids.a.visitorMessageId,
        principalId: t.id,
        emoji: "👍",
      })),
    );
  });
  return ids;
};
