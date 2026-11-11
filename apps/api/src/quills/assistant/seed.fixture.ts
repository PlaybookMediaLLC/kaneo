import { eq, sql } from "drizzle-orm";
import { withQuillsWorkspace } from "../../database/quills/client";
import { agentSkills } from "../../database/quills/schema/agent-skills";
import {
  assistantDocuments,
  assistantSnippets,
} from "../../database/quills/schema/assistant";
import { assistantGuidanceRules } from "../../database/quills/schema/assistant-guidance";
import { assistantPendingActions } from "../../database/quills/schema/assistant-pending-actions";
import { assistantWebSources } from "../../database/quills/schema/assistant-web-sources";
import { connectors } from "../../database/quills/schema/connectors";
import { conversationAttributeDefinitions } from "../../database/quills/schema/conversation-attributes";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../database/quills/schema/kb";
import { mergeSuggestions } from "../../database/quills/schema/merge-suggestions";
import { posts } from "../../database/quills/schema/posts";
import { tickets, ticketStatuses } from "../../database/quills/schema/tickets";
import { ticketTypes } from "../../database/quills/schema/ticket-types";
import { fixture, type ContractEnv } from "../framework/contract";
import { side as feedbackSide } from "../feedback/seed.fixture";
import { conversation, customer } from "../support/conversation-seed.fixture";
import { createRun } from "./runs";

// Seed helpers for the assistant fixtures and feature tests. Not fixtures themselves. Each
// fixture seeds only the rows its route reads: every seed runs several times per route.

type Db = Parameters<Parameters<ContractEnv["scoped"]>[1]>[0];
type Actor = { principalId: string };
const embed = (table: "posts" | "kb_articles", id: string) =>
  sql`UPDATE ${sql.identifier("quills")}.${sql.identifier(table)} SET embedding = array_fill(0.01::real, ARRAY[1536])::vector WHERE id = ${id}::uuid`;

/** One kind of seeded row: inserted as the workspace owner, it returns its IDs. */
const parts = {
  conversation: async (db: Db, actor: Actor, env: ContractEnv) => {
    const visitor = await customer(db, `${env.id("visitor")}@example.test`);
    return conversation(db, actor.principalId, visitor);
  },
  ticket: async (db: Db, _actor: Actor, env: ContractEnv) => {
    const [status] = await db
      .select({ id: ticketStatuses.id })
      .from(ticketStatuses)
      .where(eq(ticketStatuses.isDefault, true))
      .limit(1);
    const [type] = await db
      .insert(ticketTypes)
      .values({
        name: "Assistant",
        slug: env.id("type"),
        category: "back_office",
        fields: [
          {
            key: "plan",
            label: "Plan",
            type: "select",
            required: false,
            visibleToCustomer: true,
            order: 0,
            options: ["free", "pro"],
          },
        ],
      })
      .returning({ id: ticketTypes.id });
    const [ticket] = await db
      .insert(tickets)
      .values({
        title: "Assistant ticket",
        statusId: status!.id,
        type: "back_office",
        ticketTypeId: type!.id,
      })
      .returning({ id: tickets.id });
    return { ticketId: ticket!.id };
  },
  rule: async (db: Db) => {
    const [row] = await db
      .insert(assistantGuidanceRules)
      .values({
        name: "Be brief",
        instruction: "Answer briefly.",
        agent: "copilot",
      })
      .returning({ id: assistantGuidanceRules.id });
    return { ruleId: row!.id };
  },
  snippet: async (db: Db) => {
    const [row] = await db
      .insert(assistantSnippets)
      .values({
        title: "Refunds",
        content: "Refunds take five days.",
        audience: "team",
      })
      .returning({ id: assistantSnippets.id });
    return { snippetId: row!.id };
  },
  skill: async (db: Db, _actor: Actor, env: ContractEnv) => {
    const [row] = await db
      .insert(agentSkills)
      .values({
        name: env.id("skill"),
        whenToUse: "A refund question",
        instructions: "Check the plan first.",
        assignments: { agent: false, copilot: true },
      })
      .returning({ id: agentSkills.id });
    return { skillId: row!.id };
  },
  webSource: async (db: Db, _actor: Actor, env: ContractEnv) => {
    const [row] = await db
      .insert(assistantWebSources)
      .values({
        url: `https://docs.example.test/${env.id("page")}`,
        title: "Docs",
        content: "",
        fetchedAt: new Date(),
      })
      .returning({ id: assistantWebSources.id });
    return { webSourceId: row!.id };
  },
  document: async (db: Db) => {
    const [row] = await db
      .insert(assistantDocuments)
      .values({
        title: "Handbook",
        fileName: "handbook.md",
        mimeType: "text/markdown",
        content: "Handbook",
      })
      .returning({ id: assistantDocuments.id });
    return { documentId: row!.id };
  },
  connector: async (db: Db, _actor: Actor, env: ContractEnv) => {
    const [row] = await db
      .insert(connectors)
      .values({
        name: env.id("connector"),
        // At most 20 characters.
        slug: `c${env.id("c").split("_").pop()}_${Math.random().toString(36).slice(2, 10)}`,
        url: "https://mcp.example.test",
        authMode: "none",
      })
      .returning({ id: connectors.id });
    return { connectorId: row!.id };
  },
  attribute: async (db: Db, _actor: Actor, env: ContractEnv) => {
    const [row] = await db
      .insert(conversationAttributeDefinitions)
      .values({
        key: env.id("attr").replace(/[^a-z0-9_]/g, "_"),
        label: "Plan",
        fieldType: "text",
      })
      .returning({ id: conversationAttributeDefinitions.id });
    return { attributeId: row!.id };
  },
  article: async (db: Db, actor: Actor, env: ContractEnv) => {
    const [category] = await db
      .insert(helpCenterCategories)
      .values({ name: "Assistant", slug: env.id("category") })
      .returning({ id: helpCenterCategories.id });
    const [article] = await db
      .insert(helpCenterArticles)
      .values({
        categoryId: category!.id,
        title: "Refund policy",
        slug: env.id("article"),
        content: "Refunds take five days.",
        principalId: actor.principalId as never,
        publishedAt: new Date(),
      })
      .returning({ id: helpCenterArticles.id, uuid: sql<string>`id::text` });
    await db.execute(embed("kb_articles", article!.uuid));
    return { articleId: article!.id };
  },
};
type Part = keyof typeof parts;
type Merged<P extends Part> = P extends Part
  ? (x: Awaited<ReturnType<(typeof parts)[P]>>) => void
  : never;
type Side<P extends Part> = (Merged<P> extends (x: infer U) => void
  ? U
  : never) & { actionId: string };

/** The requested rows in one workspace. With a conversation, a pending action on it too. */
export const side = <P extends Part>(
  env: ContractEnv,
  workspaceId: string,
  wanted: readonly P[],
) =>
  env.scoped(workspaceId, async (db, actor) => {
    const out: Record<string, string> = {};
    for (const part of wanted)
      Object.assign(out, await parts[part](db, actor, env));
    if (out.conversationId) {
      const [action] = await db
        .insert(assistantPendingActions)
        .values({
          conversationId: out.conversationId as never,
          toolName: "set_conversation_priority",
          args: { priority: "high" },
          summary: "Set the conversation priority to high",
          originRole: "copilot_qa",
          expiresAt: new Date(Date.now() + 3600000),
          requestedById: actor.principalId,
        })
        .returning({ id: assistantPendingActions.id });
      out.actionId = action!.id;
    }
    return out as unknown as Side<P>;
  });

/** Both workspaces with the same rows. */
export const seedFor =
  <P extends Part>(...wanted: P[]) =>
  async (env: ContractEnv) => ({
    a: await side(env, env.a, wanted),
    b: await side(env, env.b, wanted),
  });

/** A request on rows of A, and the workspace B values for its IDs. */
export const on = <P extends Part>(
  wanted: P[],
  request: (a: Side<P>) => {
    params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  },
  foreign: (b: Side<P>) => Record<string, string>,
) =>
  fixture({
    seed: seedFor(...wanted),
    valid: (ids: { a: Side<P>; b: Side<P> }) => request(ids.a),
    foreign: (ids: { a: Side<P>; b: Side<P> }) => foreign(ids.b),
  });

/** Two embedded posts on one board and a pending suggestion that pairs them. */
export async function postsSide(env: ContractEnv, workspaceId: string) {
  const feedback = await feedbackSide(env, workspaceId);
  return env.scoped(workspaceId, async (db, actor) => {
    const [other] = await db
      .insert(posts)
      .values({
        title: "Contract twin",
        content: "Contract",
        boardId: feedback.boardId,
        principalId: actor.principalId,
        statusId: feedback.statusId,
      })
      .returning({ id: posts.id, uuid: sql<string>`id::text` });
    const [first] = await db
      .select({ uuid: sql<string>`id::text` })
      .from(posts)
      .where(eq(posts.id, feedback.postId));
    await db.execute(embed("posts", first!.uuid));
    await db.execute(embed("posts", other!.uuid));
    const [suggestion] = await db
      .insert(mergeSuggestions)
      .values({
        sourcePostId: other!.id,
        targetPostId: feedback.postId,
        vectorScore: 0.95,
        ftsScore: 0,
        hybridScore: 0.95,
        llmConfidence: 0.9,
        llmReasoning: "Same request",
      })
      .returning({ id: mergeSuggestions.id });
    return {
      ...feedback,
      otherPostId: other!.id,
      suggestionId: suggestion!.id,
    };
  });
}
export const seedPosts = async (env: ContractEnv) => ({
  a: await postsSide(env, env.a),
  b: await postsSide(env, env.b),
});
export type PostIds = Awaited<ReturnType<typeof seedPosts>>;

/** A copilot run of `userId` (default: the owner) in a workspace. */
export const runOf = (
  env: ContractEnv,
  workspaceId: string,
  userId?: string,
) => {
  const work = async (db: Db, actor: Actor) =>
    (await createRun(db, actor.principalId, "copilot", { question: "Hi" })).id;
  return userId
    ? withQuillsWorkspace({ workspaceId, userId }, work)
    : env.scoped(workspaceId, work);
};
