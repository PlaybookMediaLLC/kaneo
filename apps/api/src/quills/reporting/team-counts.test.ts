import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { feedbackSignals } from "../../database/quills/schema/feedback-signals";
import { mergeSuggestions } from "../../database/quills/schema/merge-suggestions";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { ticketStatuses, tickets } from "../../database/quills/schema/tickets";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import { postIn, statusIn } from "../feedback/seeds.fixture";
import {
  call,
  customer,
  linkedProject,
  removeMembers,
  restrictedMember,
  testCustomer,
} from "../feedback/taxonomy-harness.fixture";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter);

type Counts = Record<string, number> & {
  postStatuses: { id: string; name: string; count: number }[];
};
const counts = async (user: string) => {
  const res = await call(
    app,
    contractEnv(),
    user,
    "GET",
    "/reporting/team-counts",
  );
  expect(res.status).toBe(200);
  return res.body as Counts;
};
const delta = (after: Counts, before: Counts) =>
  Object.fromEntries(
    Object.keys(after)
      .filter((key) => key !== "postStatuses")
      .map((key) => [key, after[key]! - before[key]!]),
  );
/** The post count of one status in the counts, or undefined when the status is not listed. */
const postsIn = (counts: Counts, statusId: string) =>
  counts.postStatuses.find((status) => status.id === statusId)?.count;

type Conversation = Partial<typeof conversations.$inferInsert>;
/** A conversation in `workspaceId` with one visitor message, and a signal from it when asked. */
const conversationIn = (
  env: ContractEnv,
  workspaceId: string,
  visitorId: string,
  values: Conversation,
  signal?: "pending" | "dismissed",
) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(conversations)
      .values({
        visitorPrincipalId: visitorId as never,
        channel: "messenger",
        ...values,
      })
      .returning({ id: conversations.id });
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: row!.id,
        principalId: visitorId as never,
        senderType: "visitor",
        content: "Please add a dark mode",
      })
      .returning({ id: conversationMessages.id });
    if (signal)
      await db.insert(feedbackSignals).values({
        conversationId: row!.id,
        sourceMessageId: message!.id,
        principalId: visitorId as never,
        excerpt: "Please add a dark mode",
        suggestedTitle: "Dark mode",
        status: signal,
        decidedAt: signal === "dismissed" ? new Date() : null,
      });
  });

/** A pending or dismissed merge suggestion between two new posts of one board. */
async function suggestionIn(env: ContractEnv, status: "pending" | "dismissed") {
  const first = await postIn(env, env.a);
  await env.scoped(env.a, async (db, actor) => {
    const [second] = await db
      .insert(posts)
      .values({
        title: "Contract twin",
        content: "Contract",
        boardId: first.boardId,
        principalId: actor.principalId,
      })
      .returning({ id: posts.id });
    await db.insert(mergeSuggestions).values({
      sourcePostId: second!.id,
      targetPostId: first.postId,
      vectorScore: 0.95,
      ftsScore: 0,
      hybridScore: 0.95,
      llmConfidence: 0.9,
      status,
    });
  });
  return first.boardId;
}

describe.skipIf(!url)("Quills teammate app counts", () => {
  let member: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    // The built-in member role reads Quills. This member opens no project.
    member = await restrictedMember(contractEnv(), []);
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    await stopContract();
  });

  it("counts only what each caller can read in the matching list", async () => {
    const env = contractEnv();
    const [ownerBefore, memberBefore] = [
      await counts(env.owner),
      await counts(member),
    ];
    const visitor = await customer(env);
    const tester = await testCustomer(env);
    const owner = await env.scoped(
      env.a,
      async (_db, actor) => actor.principalId,
    );
    await conversationIn(env, env.a, visitor, {
      status: "open",
      assignedAgentPrincipalId: owner,
    });
    // The queue: open and waiting for a team reply.
    await conversationIn(env, env.a, visitor, {
      status: "open",
      waitingSince: new Date(),
    });
    await conversationIn(env, env.a, visitor, {
      status: "open",
      assignedAgentPrincipalId: visitor as never,
    });
    // Not counted: snoozed, closed with a pending signal, spam and a test customer's thread.
    await conversationIn(
      env,
      env.a,
      visitor,
      { status: "snoozed", waitingSince: new Date() },
      "dismissed",
    );
    await conversationIn(env, env.a, visitor, { status: "closed" }, "pending");
    await conversationIn(env, env.a, visitor, {
      status: "open",
      endReason: "spam",
    });
    await conversationIn(env, env.a, tester, { status: "open" }, "pending");
    await env.scoped(env.a, async (db) => {
      const status = async (category: "open" | "closed") =>
        (
          await db
            .select({ id: ticketStatuses.id })
            .from(ticketStatuses)
            .where(eq(ticketStatuses.category, category))
            .limit(1)
        )[0]!.id;
      const open = await status("open");
      await db.insert(tickets).values([
        {
          title: "Open",
          statusId: open,
          requesterPrincipalId: visitor as never,
        },
        {
          title: "Closed",
          statusId: await status("closed"),
          requesterPrincipalId: visitor as never,
        },
        {
          title: "Deleted",
          statusId: open,
          requesterPrincipalId: visitor as never,
          deletedAt: new Date(),
        },
      ]);
    });
    await suggestionIn(env, "pending");
    await suggestionIn(env, "dismissed");
    // The member cannot open the project that this board is linked to.
    await linkedProject(env, await suggestionIn(env, "pending"));
    // Workspace B never counts in A.
    const foreign = await env.scoped(
      env.b,
      async (db, actor) => actor.principalId,
    );
    await conversationIn(env, env.b, foreign, { status: "open" }, "pending");

    expect(delta(await counts(env.owner), ownerBefore)).toEqual({
      myConversations: 1,
      unassignedConversations: 1,
      openConversations: 3,
      queueConversations: 1,
      openTickets: 1,
      pendingDuplicates: 2,
      pendingSignals: 1,
    });
    expect(delta(await counts(member), memberBefore)).toEqual({
      myConversations: 0,
      unassignedConversations: 1,
      openConversations: 3,
      queueConversations: 1,
      openTickets: 1,
      pendingDuplicates: 1,
      pendingSignals: 1,
    });
  });

  it("counts the visible posts of each open status, in status order", async () => {
    const env = contractEnv();
    const status = await statusIn(env, env.a);
    const tester = await testCustomer(env);
    const shown = await postIn(env, env.a, { statusId: status as never });
    // The member cannot open the project of this board; the owner can.
    const hidden = await postIn(env, env.a, { statusId: status as never });
    await linkedProject(env, hidden.boardId);
    // Not counted: a deleted post, a merged post and a test customer's post.
    await postIn(env, env.a, {
      statusId: status as never,
      deletedAt: new Date(),
    });
    await postIn(env, env.a, {
      statusId: status as never,
      canonicalPostId: shown.postId,
    });
    await postIn(env, env.a, {
      statusId: status as never,
      principalId: tester as never,
    });
    // A complete status and a status of workspace B are not listed.
    const [complete] = await env.scoped(env.a, (db) =>
      db
        .insert(postStatuses)
        .values({ name: "Done", slug: env.id("status"), category: "complete" })
        .returning({ id: postStatuses.id }),
    );
    await postIn(env, env.a, { statusId: complete!.id });
    const foreign = await statusIn(env, env.b);

    const owner = await counts(env.owner);
    expect(postsIn(owner, status)).toBe(2);
    expect(postsIn(owner, complete!.id)).toBeUndefined();
    expect(postsIn(owner, foreign)).toBeUndefined();
    expect(postsIn(await counts(member), status)).toBe(1);
    const ordered = await env.scoped(env.a, (db) =>
      db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(
          and(
            eq(postStatuses.category, "active"),
            isNull(postStatuses.deletedAt),
          ),
        )
        .orderBy(asc(postStatuses.position), asc(postStatuses.id)),
    );
    expect(owner.postStatuses.map((row) => row.id)).toEqual(
      ordered.map((row) => row.id),
    );
  });
});
