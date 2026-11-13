import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import {
  principal,
  settings,
  user,
} from "../../../database/quills/schema/auth";
import { channelAccounts } from "../../../database/quills/schema/channel-accounts";
import { channelThreads } from "../../../database/quills/schema/channel-threads";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { hookDeliveries } from "../../../database/quills/schema/hook-deliveries";
import {
  integrationPlatformCredentials,
  integrations,
} from "../../../database/quills/schema/integrations";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { kvStore } from "../../../database/quills/schema/kv";
import { slackUserLinks } from "../../../database/quills/schema/slack";
import { userAttributeDefinitions } from "../../../database/quills/schema/user-attributes";
import { encryptSecret } from "../../../notification-preferences/secrets";
import type { BaseVariables } from "../../../openapi";
import router from "../..";
import publicRouter from "../../public";
import { provider } from "../../assistant/provider-edge.fixture";
import { recordQuillsChange } from "../../events";
import {
  providerCalls,
  providerOverrides,
} from "../../integrations/provider-edge.fixture";
import { slackDelivery } from "../../integrations/slack-hook.fixture";
import { defaultTeam } from "../../support/github-inbox.fixture";
import { ingestGitHub, outboundMarker } from "../../support/github-ingest";
import { claimFrom } from "../queue";
import { drainQuillsWorkspace } from "../worker";
import { runAiJob } from "./ai";
import { runGitHubCommentJob } from "./github-comment";
import { harness } from "./harness.fixture";

// RFC 0001 lane G1: the GitHub inbox (ingest and outbound comments) and the Slack assistant's
// answer, on real PostgreSQL with the local provider servers. Each send has a receipt before the
// provider call: a rerun, a lost lease and an expired lease never send twice.

let pool: Pool;
vi.mock("../../../database/index", () => ({
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
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("agentch");
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-agent-test-key";
const seal = (values: Record<string, string>) =>
  encryptSecret(JSON.stringify(values))!;
const COMMENTS = "/api.github.com/repos/acme/app/issues/7/comments";
const calls = (method: string, path: string) =>
  providerCalls.filter(
    (call) => call.method === method && call.path.split("?")[0] === path,
  );
const onlyEvents = (workspaceId: string) =>
  drainQuillsWorkspace(workspaceId, async () => {}, ["quills.event"]);

/** The GitHub connection, the inbox account and a conversation on issue acme/app#7, in A. */
async function githubInbox() {
  return h.as(h.a, h.owner, async (db, actor) => {
    await db
      .delete(integrations)
      .where(eq(integrations.integrationType, "github"));
    const [connection] = await db
      .insert(integrations)
      .values({
        integrationType: "github",
        status: "active",
        secrets: seal({ accessToken: "gho_inbox", webhookSecret: "whsec" }),
        config: {
          account: "kaneo-bot",
          statusSync: { target: "acme:app", hookId: "1", state: "active" },
        },
        connectedByPrincipalId: actor.principalId,
        connectedAt: new Date(),
      })
      .returning({ id: integrations.id });
    const team = await defaultTeam(db);
    await db
      .update(channelAccounts)
      .set({ deletedAt: new Date() })
      .where(eq(channelAccounts.channel, "github"));
    const [account] = await db
      .insert(channelAccounts)
      .values({
        owningTeamId: team,
        channel: "github",
        role: "connection",
        config: { integrationId: connection!.id },
      })
      .returning({ id: channelAccounts.id });
    const [conversation] = await db
      .insert(conversations)
      .values({
        visitorPrincipalId: actor.principalId,
        channel: "github",
        source: "github",
        channelAccountId: account!.id,
      })
      .returning({ id: conversations.id });
    // Each test has its own account, so issue 7 of acme/app maps to this conversation.
    await db.insert(channelThreads).values({
      channelAccountId: account!.id,
      externalThreadKey: "acme/app#7",
      conversationId: conversation!.id,
    });
    return {
      integrationId: connection!.id,
      accountId: account!.id,
      conversationId: conversation!.id,
    };
  });
}

/** A teammate reply on the conversation, recorded as the reply route does. */
const reply = (conversationId: string, content = "Thanks, fixed in 1.2") =>
  h.as(h.a, h.owner, async (db, actor) => {
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversationId as never,
        principalId: actor.principalId,
        senderType: "agent",
        content,
      })
      .returning({ id: conversationMessages.id });
    await recordQuillsChange(db, actor, {
      type: "message.created",
      entityType: "conversation_message",
      entityId: message!.id,
      payload: { conversationId },
    });
    return message!.id;
  });
const retryEvent = (messageId: string, conversationId: string) =>
  h.as(h.a, h.owner, (db, actor) =>
    recordQuillsChange(db, actor, {
      type: "github_inbox.message_retried",
      entityType: "conversation_message",
      entityId: messageId,
      payload: { conversationId },
    }),
  );
const metadata = async (messageId: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select({ metadata: conversationMessages.metadata })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, messageId as never)),
    )
  )[0]!.metadata;
const receipt = async (key: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select({ outcome: hookDeliveries.outcome })
        .from(hookDeliveries)
        .where(eq(hookDeliveries.jobId, key)),
    )
  )[0]?.outcome;
/** Claims the next job of `queue` and lets its lease run out, as a worker that stalls would. */
const stalledJob = async (queue: "quills.webhook" | "quills.ai") => {
  const job = (await h.system(h.a, claimFrom([queue])))!;
  await h.system(h.a, (db) =>
    db
      .update(jobQueue)
      .set({ lockedUntil: sql`now() - interval '1 second'` })
      .where(eq(jobQueue.id, job.id)),
  );
  return job;
};
const jobRow = async (queue: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select()
        .from(jobQueue)
        .where(eq(jobQueue.queue, queue))
        .orderBy(sql`${jobQueue.id} desc`)
        .limit(1),
    )
  )[0]!;

describe.skipIf(!url)("Agent channels", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });
  // GitHub comment IDs are unique: each test's first comment gets a new one.
  let commentId = 555;
  beforeEach(() => {
    providerCalls.length = 0;
    commentId += 10;
    providerOverrides.set(`POST ${COMMENTS}`, {
      status: 201,
      body: { id: commentId },
    });
    providerOverrides.set(`GET ${COMMENTS}`, { status: 200, body: [] });
  });
  afterEach(() => {
    providerOverrides.clear();
    provider.reply();
  });

  describe("GitHub inbox ingest", () => {
    const comment = (id: number, body: string, login = "octocat") => ({
      action: "created",
      issue: {
        number: 7,
        title: "Crash",
        body: "It crashes",
        user: { id: 9, login: "octocat" },
      },
      comment: { id, body, user: { id: 9, login } },
      repository: { full_name: "acme/app" },
    });

    it("stores a new comment once, and skips our own comments", async () => {
      const inbox = await githubInbox();
      const connection = {
        integrationId: inbox.integrationId,
        config: { account: "kaneo-bot" },
      };
      const first = await h.system(h.a, (db) =>
        ingestGitHub(db, connection, comment(1001, "Still broken")),
      );
      expect(first).toMatchObject({
        kind: "message",
        conversationId: inbox.conversationId,
      });
      expect(first!.messageIds).toHaveLength(1);
      // A redelivery, the connected account's comment and a comment with our marker change nothing.
      for (const event of [
        comment(1001, "Still broken"),
        comment(1002, "From the bot", "kaneo-bot"),
        comment(
          1003,
          `Reply\n\n${outboundMarker("conversation_msg_01h0000000000000000000000a")}`,
        ),
      ])
        expect(
          await h.system(h.a, (db) => ingestGitHub(db, connection, event)),
        ).toBeNull();
      const closed = await h.system(h.a, (db) =>
        ingestGitHub(db, connection, {
          action: "closed",
          issue: { number: 7 },
          repository: { full_name: "acme/app" },
        }),
      );
      expect(closed).toMatchObject({ kind: "closed", messageIds: [] });
      // Another connection, or the inbox off: nothing.
      await h.system(h.a, (db) =>
        db
          .update(channelAccounts)
          .set({ deletedAt: new Date() })
          .where(eq(channelAccounts.id, inbox.accountId)),
      );
      expect(
        await h.system(h.a, (db) =>
          ingestGitHub(db, connection, comment(1004, "Hello?")),
        ),
      ).toBeNull();
    });

    it("opens conversations for new issues, and skips pull requests and the bot's issues", async () => {
      const inbox = await githubInbox();
      const connection = {
        integrationId: inbox.integrationId,
        config: { account: "kaneo-bot" },
      };
      const ingest = (event: Parameters<typeof ingestGitHub>[2]) =>
        h.system(h.a, (db) => ingestGitHub(db, connection, event));
      const issue = (number: number, login = "octocat") => ({
        number,
        title: `Issue ${number}`,
        body: "Please help",
        user: { id: 21, login },
      });
      const opened = await ingest({
        action: "opened",
        issue: issue(8),
        repository: { full_name: "acme/app" },
      });
      expect(opened).toMatchObject({ kind: "message" });
      expect(opened!.conversationId).not.toBe(inbox.conversationId);
      // The first comment on an issue with no conversation stores the issue text and the comment.
      const first = await ingest({
        ...comment(1101, "Any news?"),
        issue: issue(9),
      });
      expect(first!.messageIds).toHaveLength(2);
      // The same GitHub user is one principal across both conversations.
      const visitors = await h.system(h.a, (db) =>
        db
          .select({ visitor: conversations.visitorPrincipalId })
          .from(conversations)
          .where(
            inArray(conversations.id, [
              opened!.conversationId,
              first!.conversationId,
            ] as never[]),
          ),
      );
      expect(new Set(visitors.map((row) => row.visitor)).size).toBe(1);
      for (const event of [
        {
          action: "opened",
          issue: { ...issue(10), pull_request: {} },
          repository: { full_name: "acme/app" },
        },
        {
          action: "opened",
          issue: issue(11, "kaneo-bot"),
          repository: { full_name: "acme/app" },
        },
        // Older than the replay horizon.
        {
          ...comment(1102, "Old"),
          comment: {
            id: 1102,
            body: "Old",
            updated_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
          },
        },
      ])
        expect(await ingest(event)).toBeNull();
    });

    it("follows a customer's edit and delete, and never changes a teammate reply", async () => {
      const inbox = await githubInbox();
      const connection = {
        integrationId: inbox.integrationId,
        config: { account: "kaneo-bot" },
      };
      const ingest = (event: Parameters<typeof ingestGitHub>[2]) =>
        h.system(h.a, (db) => ingestGitHub(db, connection, event));
      const created = await ingest(comment(1201, "Broken"));
      const [customerMessage] = created!.messageIds;
      expect(
        await ingest({ ...comment(1201, "Broken on 1.2"), action: "edited" }),
      ).toMatchObject({ kind: "edited", messageIds: [customerMessage] });
      // A teammate reply that went out as comment 1202.
      const replyId = await reply(inbox.conversationId, "Our reply");
      await h.system(h.a, (db) =>
        db
          .update(conversationMessages)
          .set({ metadata: { githubCommentId: "1202" } })
          .where(eq(conversationMessages.id, replyId as never)),
      );
      expect(
        await ingest({
          ...comment(1202, "Changed on GitHub"),
          action: "edited",
        }),
      ).toBeNull();
      expect(
        await ingest({ ...comment(1202, "", "kaneo-bot"), action: "deleted" }),
      ).toBeNull();
      expect(
        await ingest({ ...comment(1201, ""), action: "deleted" }),
      ).toMatchObject({ kind: "deleted" });
      const rows = await h.system(h.a, (db) =>
        db
          .select({
            id: conversationMessages.id,
            content: conversationMessages.content,
            deletedAt: conversationMessages.deletedAt,
          })
          .from(conversationMessages)
          .where(
            inArray(conversationMessages.id, [
              customerMessage,
              replyId,
            ] as never[]),
          ),
      );
      const byId = new Map(rows.map((row) => [row.id as string, row]));
      expect(byId.get(customerMessage!)).toMatchObject({
        content: "Broken on 1.2",
      });
      expect(byId.get(customerMessage!)!.deletedAt).not.toBeNull();
      expect(byId.get(replyId)).toMatchObject({
        content: "Our reply",
        deletedAt: null,
      });
    });
  });

  describe("GitHub inbox comments", () => {
    it("posts a reply once with its marker, also when the job is replayed", async () => {
      const inbox = await githubInbox();
      const messageId = await reply(inbox.conversationId);
      await h.drain(h.a);
      const posted = calls("POST", COMMENTS);
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0]!.body).body).toContain(
        outboundMarker(messageId),
      );
      expect(posted[0]!.authorization).toBe("Bearer gho_inbox");
      expect(await metadata(messageId)).toMatchObject({
        githubCommentId: String(commentId),
        channelDelivery: { status: "sent", externalId: String(commentId) },
      });
      expect(await receipt(`github-comment:${messageId}`)).toBe("completed");
      // The same job again: the receipt stops a second comment.
      await h.system(h.a, (db) =>
        db
          .update(jobQueue)
          .set({ status: "pending", runAt: new Date(0) })
          .where(eq(jobQueue.queue, "quills.webhook")),
      );
      await h.drain(h.a);
      expect(calls("POST", COMMENTS)).toHaveLength(1);
    });

    it("treats an attempt that stopped after its claim as uncertain", async () => {
      const inbox = await githubInbox();
      const messageId = await reply(inbox.conversationId);
      await onlyEvents(h.a);
      await h.system(h.a, (db) =>
        db.insert(hookDeliveries).values({
          jobId: `github-comment:${messageId}`,
          hookType: "github_comment",
          outcome: "processing",
        }),
      );
      await h.drain(h.a);
      expect(calls("POST", COMMENTS)).toHaveLength(0);
      expect(await receipt(`github-comment:${messageId}`)).toBe("uncertain");
      expect(await metadata(messageId)).toMatchObject({
        channelDelivery: { status: "failed" },
      });
      expect((await jobRow("quills.webhook")).status).toBe("failed");
    });

    it("keeps the comment when the lease expires during the send, and the replacement sends nothing", async () => {
      const inbox = await githubInbox();
      const messageId = await reply(inbox.conversationId);
      await onlyEvents(h.a);
      const job = await stalledJob("quills.webhook");
      // The stalled worker still sends and records the outcome, but cannot finish its job.
      await expect(runGitHubCommentJob(h.a, job)).rejects.toThrow("lease lost");
      expect(calls("POST", COMMENTS)).toHaveLength(1);
      expect(await receipt(`github-comment:${messageId}`)).toBe("completed");
      // The replacement claims the expired job and finds the receipt.
      await h.drain(h.a);
      expect(calls("POST", COMMENTS)).toHaveLength(1);
      expect(await jobRow("quills.webhook")).toMatchObject({
        status: "succeeded",
        attempts: 2,
      });
    });

    it("never posts an uncertain send again, and a retry finds the comment first", async () => {
      const inbox = await githubInbox();
      providerOverrides.set(`POST ${COMMENTS}`, "drop");
      const messageId = await reply(inbox.conversationId);
      await h.drain(h.a);
      expect(calls("POST", COMMENTS)).toHaveLength(1);
      expect(await receipt(`github-comment:${messageId}`)).toBe("uncertain");
      // GitHub did store it: the teammate's retry finds the marker and posts nothing.
      providerOverrides.set(`GET ${COMMENTS}`, {
        status: 200,
        body: [
          { id: commentId + 1, body: `Thanks\n\n${outboundMarker(messageId)}` },
        ],
      });
      const eventId = await retryEvent(messageId, inbox.conversationId);
      await h.drain(h.a);
      expect(calls("POST", COMMENTS)).toHaveLength(1);
      expect(calls("GET", COMMENTS)).toHaveLength(1);
      expect(await metadata(messageId)).toMatchObject({
        githubCommentId: String(commentId + 1),
        channelDelivery: { status: "sent" },
      });
      expect(await receipt(`github-comment:${messageId}:${eventId}`)).toBe(
        "completed",
      );
    });

    it("retries a refused comment as a new attempt", async () => {
      const inbox = await githubInbox();
      providerOverrides.set(`POST ${COMMENTS}`, { status: 422 });
      const messageId = await reply(inbox.conversationId);
      await h.drain(h.a);
      expect(await metadata(messageId)).toMatchObject({
        channelDelivery: {
          status: "failed",
          error: "GitHub rejected the comment.",
        },
      });
      providerOverrides.set(`POST ${COMMENTS}`, {
        status: 201,
        body: { id: commentId + 1 },
      });
      await retryEvent(messageId, inbox.conversationId);
      await h.drain(h.a);
      expect(calls("POST", COMMENTS)).toHaveLength(2);
      expect(await metadata(messageId)).toMatchObject({
        githubCommentId: String(commentId + 1),
      });
    });

    it("sends nothing while the inbox is off", async () => {
      const inbox = await githubInbox();
      await h.system(h.a, (db) =>
        db
          .update(channelAccounts)
          .set({ deletedAt: new Date() })
          .where(eq(channelAccounts.id, inbox.accountId)),
      );
      const messageId = await reply(inbox.conversationId);
      await h.drain(h.a);
      expect(calls("POST", COMMENTS)).toHaveLength(0);
      expect(await metadata(messageId)).toMatchObject({
        channelDelivery: {
          status: "failed",
          error: "The GitHub inbox is off.",
        },
      });
    });
  });

  describe("Slack assistant", () => {
    const POST = "/slack.com/api/chat.postMessage";
    const EPHEMERAL = "/slack.com/api/chat.postEphemeral";
    let hookCount = 0;

    /** The Slack connection, the switch on, and one stored mention; returns the hook's event. */
    async function mention(slackUser = "UASKER") {
      const hook = `slack-hook:Ev${Date.now()}${hookCount++}`;
      await h.as(h.a, h.owner, async (db, actor) => {
        await db
          .delete(integrations)
          .where(eq(integrations.integrationType, "slack"));
        await db.insert(integrations).values({
          integrationType: "slack",
          status: "active",
          secrets: seal({ accessToken: "xoxb-test" }),
          config: { teamId: "T1", botUserId: "UBOT" },
          connectedByPrincipalId: actor.principalId,
          connectedAt: new Date(),
        });
        await db.update(settings).set({
          assistantConfig: sql`jsonb_set(${settings.assistantConfig}, '{agents,workspace,slack,enabled}', 'true'::jsonb)`,
        });
        await db.insert(kvStore).values({
          workspaceKey: "_",
          key: hook,
          value: {
            team: "T1",
            channel: "C1",
            user: slackUser,
            ts: "1.1",
            threadTs: null,
            text: "<@UBOT> what shipped?",
          },
          expiresAt: new Date(Date.now() + 60_000),
        });
        await recordQuillsChange(db, null, {
          type: "integration.hook_received",
          entityType: "integration",
          entityId: "slack",
          payload: { provider: "slack", hook },
        });
      });
      return hook;
    }

    beforeAll(async () => {
      await h
        .db()
        .update(kaneo.userTable)
        .set({ emailVerified: true })
        .where(eq(kaneo.userTable.id, h.owner));
    });
    beforeEach(() => {
      providerOverrides.set("GET /slack.com/api/users.info", {
        status: 200,
        body: {
          ok: true,
          user: { profile: { email: `${h.owner}@example.test` } },
        },
      });
      providerOverrides.set(`POST ${EPHEMERAL}`, {
        status: 200,
        body: { ok: true },
      });
    });

    it("links the asker by verified email and answers once in the thread", async () => {
      const hook = await mention();
      await h.drain(h.a);
      const posted = calls("POST", POST);
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0]!.body)).toMatchObject({
        channel: "C1",
        thread_ts: "1.1",
        text: expect.stringContaining("Contract answer"),
      });
      expect(await receipt(`slack-answer:${hook}`)).toBe("completed");
      const [link] = await h.system(h.a, (db) =>
        db
          .select({ method: slackUserLinks.method })
          .from(slackUserLinks)
          .where(
            and(
              eq(slackUserLinks.slackTeamId, "T1"),
              eq(slackUserLinks.slackUserId, "UASKER"),
            ),
          ),
      );
      expect(link?.method).toBe("email");
      // The job again: no second answer.
      await h.system(h.a, (db) =>
        db
          .update(jobQueue)
          .set({ status: "pending", runAt: new Date(0) })
          .where(eq(jobQueue.queue, "quills.ai")),
      );
      await h.drain(h.a);
      expect(calls("POST", POST)).toHaveLength(1);
    });

    it("escapes model text, so an answer cannot mention a channel", async () => {
      provider.reply(() => ({
        json: {
          choices: [
            { message: { content: JSON.stringify({ text: "<!channel> hi" }) } },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      }));
      await mention();
      await h.drain(h.a);
      const text = JSON.parse(calls("POST", POST)[0]!.body).text as string;
      expect(text).toContain("&lt;!channel&gt; hi");
      expect(text).not.toContain("<!channel>");
    });

    it("refuses a Slack user who is not a teammate, in an ephemeral message", async () => {
      providerOverrides.set("GET /slack.com/api/users.info", {
        status: 200,
        body: { ok: true, user: { profile: { email: "someone@else.test" } } },
      });
      await mention("USTRANGER");
      await h.drain(h.a);
      expect(calls("POST", POST)).toHaveLength(0);
      const refused = calls("POST", EPHEMERAL);
      expect(refused).toHaveLength(1);
      expect(JSON.parse(refused[0]!.body)).toMatchObject({
        user: "USTRANGER",
        text: expect.stringContaining("only answer teammates"),
      });
    });

    it("posts nothing for an attempt that stopped after its claim", async () => {
      const hook = await mention();
      await onlyEvents(h.a);
      await h.system(h.a, (db) =>
        db.insert(hookDeliveries).values({
          jobId: `slack-answer:${hook}`,
          hookType: "slack_answer",
          outcome: "processing",
        }),
      );
      await h.drain(h.a);
      expect(calls("POST", POST)).toHaveLength(0);
      expect(await receipt(`slack-answer:${hook}`)).toBe("uncertain");
    });

    it("keeps the answer when the lease expires during the send, and the replacement posts nothing", async () => {
      const hook = await mention();
      await onlyEvents(h.a);
      const job = await stalledJob("quills.ai");
      await expect(runAiJob(h.a, job)).rejects.toThrow("lease lost");
      expect(calls("POST", POST)).toHaveLength(1);
      expect(await receipt(`slack-answer:${hook}`)).toBe("completed");
      await h.drain(h.a);
      expect(calls("POST", POST)).toHaveLength(1);
      expect(await jobRow("quills.ai")).toMatchObject({
        status: "succeeded",
        attempts: 2,
      });
    });

    it("answers nothing once the assistant is off", async () => {
      await mention();
      await h.system(h.a, (db) =>
        db.update(settings).set({
          assistantConfig: sql`jsonb_set(${settings.assistantConfig}, '{agents,workspace,slack,enabled}', 'false'::jsonb)`,
        }),
      );
      await h.drain(h.a);
      expect(calls("POST", POST)).toHaveLength(0);
      expect(calls("POST", EPHEMERAL)).toHaveLength(0);
    });

    it("refuses a linked teammate who lost access, and an unverified email", async () => {
      // UMATE was linked while the member could read; the member then left the workspace.
      const matePrincipal = await h.principal(h.a, h.mate);
      await h.system(h.a, (db) =>
        db.insert(slackUserLinks).values({
          slackTeamId: "T1",
          slackUserId: "UMATE",
          principalId: matePrincipal as never,
          method: "email",
        }),
      );
      await h
        .db()
        .delete(kaneo.workspaceUserTable)
        .where(
          and(
            eq(kaneo.workspaceUserTable.workspaceId, h.a),
            eq(kaneo.workspaceUserTable.userId, h.mate),
          ),
        );
      await mention("UMATE");
      await h.drain(h.a);
      // The link decides: no profile lookup, and a refusal only the asker sees.
      expect(calls("GET", "/slack.com/api/users.info")).toHaveLength(0);
      expect(calls("POST", POST)).toHaveLength(0);
      expect(calls("POST", EPHEMERAL)).toHaveLength(1);
      // An unverified account email links no one.
      await h
        .db()
        .update(kaneo.userTable)
        .set({ emailVerified: false })
        .where(eq(kaneo.userTable.id, h.owner));
      try {
        await mention("UNVERIFIED");
        await h.drain(h.a);
        expect(calls("POST", POST)).toHaveLength(0);
        expect(calls("POST", EPHEMERAL)).toHaveLength(2);
      } finally {
        await h
          .db()
          .update(kaneo.userTable)
          .set({ emailVerified: true })
          .where(eq(kaneo.userTable.id, h.owner));
      }
    });
  });

  describe("Routes", () => {
    const app = new Hono<{
      Variables: BaseVariables & { workspaceId: string };
    }>();
    app.use("*", async (c, next) => {
      c.set("userId", h.owner);
      c.set("user", null);
      await next();
    });
    app.route("/quills", router);
    app.route("/quills-public", publicRouter);
    const call = (path: string, method = "GET", body?: unknown) =>
      app.request(`/quills/${h.a}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    const signed = (
      path: string,
      raw: string,
      headers: Record<string, string>,
    ) =>
      app.request(`/quills-public/signed${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: raw,
      });
    const retry = (messageId: string) =>
      call(`/conversation-messages/${messageId}/github-retry`, "POST");

    it("retries only a failed reply, once", async () => {
      const inbox = await githubInbox();
      providerOverrides.set(`POST ${COMMENTS}`, { status: 422 });
      const messageId = await reply(inbox.conversationId);
      await h.drain(h.a);
      providerOverrides.set(`POST ${COMMENTS}`, {
        status: 201,
        body: { id: commentId + 5 },
      });
      const retried = await retry(messageId);
      expect(retried.status).toBe(200);
      expect(await retried.json()).toMatchObject({ status: "pending" });
      // A second retry while the first is pending is refused.
      expect((await retry(messageId)).status).toBe(409);
      await h.drain(h.a);
      expect(calls("POST", COMMENTS)).toHaveLength(2);
      expect(await metadata(messageId)).toMatchObject({
        githubCommentId: String(commentId + 5),
      });
      // On GitHub now: no retry. A reply that was never attempted is still being sent.
      expect((await retry(messageId)).status).toBe(409);
      const fresh = await reply(inbox.conversationId, "Another");
      expect((await retry(fresh)).status).toBe(409);
    });

    it("switches the inbox in the webhook, restores its account, and stops with status sync", async () => {
      const inbox = await githubInbox();
      const PATCH = "/api.github.com/repos/acme/app/hooks/1";
      const toggle = async (enabled: boolean) =>
        (await call("/channels/github/inbox", "PUT", { enabled })).json();
      providerOverrides.set(`PATCH ${PATCH}`, { status: 200, body: { id: 1 } });
      expect(await toggle(false)).toMatchObject({
        inboxEnabled: false,
        changed: true,
      });
      expect(await toggle(true)).toMatchObject({
        inboxEnabled: true,
        changed: true,
      });
      expect(
        calls("PATCH", PATCH).map((patch) => JSON.parse(patch.body).events),
      ).toEqual([["issues"], ["issues", "issue_comment"]]);
      // The earlier account keeps its issue threads.
      const [live] = await h.system(h.a, (db) =>
        db
          .select({ id: channelAccounts.id })
          .from(channelAccounts)
          .where(
            and(
              eq(channelAccounts.channel, "github"),
              sql`${channelAccounts.deletedAt} is null`,
            ),
          ),
      );
      expect(live?.id).toBe(inbox.accountId);
      // A webhook update that fails keeps the switch and says so.
      providerOverrides.set(`PATCH ${PATCH}`, { status: 500 });
      expect(await toggle(false)).toMatchObject({
        inboxEnabled: false,
        lastError: expect.any(String),
      });
      await toggle(true);
      // Status sync off: its webhook goes, so the inbox goes too.
      expect(
        (
          await call(
            `/integrations/${inbox.integrationId}/status-sync`,
            "DELETE",
          )
        ).status,
      ).toBe(200);
      expect(await (await call("/channels/github")).json()).toMatchObject({
        inboxEnabled: false,
      });
    });

    it("answers Slack's URL check and ignores another team's event", async () => {
      const seeded = await h.as(h.a, h.owner, async (db, actor) => {
        for (const table of [integrations, integrationPlatformCredentials])
          await db.delete(table).where(eq(table.integrationType, "slack"));
        await db.insert(integrationPlatformCredentials).values({
          integrationType: "slack",
          secrets: seal({
            clientId: "c",
            clientSecret: "s",
            signingSecret: "sig",
          }),
        });
        const [row] = await db
          .insert(integrations)
          .values({
            integrationType: "slack",
            status: "active",
            secrets: seal({ accessToken: "xoxb-test" }),
            config: { teamId: "T1", botUserId: "UBOT" },
            connectedByPrincipalId: actor.principalId,
            connectedAt: new Date(),
          })
          .returning({ id: integrations.id });
        await db.update(settings).set({
          assistantConfig: sql`jsonb_set(${settings.assistantConfig}, '{agents,workspace,slack,enabled}', 'true'::jsonb)`,
        });
        return {
          integrationId: row!.id,
          signingSecret: "sig",
          teamId: "T1",
          revision: 1,
        };
      });
      const send = async (raw: string) =>
        signed(
          `/integrations/slack/${seeded.integrationId}/hooks/events`,
          raw,
          slackDelivery(seeded, "sig", { raw }).headers as Record<
            string,
            string
          >,
        );
      const check = await send(
        JSON.stringify({ type: "url_verification", challenge: "c-123" }),
      );
      expect(await check.json()).toEqual({
        challenge: "c-123",
        accepted: false,
      });
      const event = (team: string, id: string) =>
        JSON.stringify({
          type: "event_callback",
          team_id: team,
          event_id: id,
          event: {
            type: "app_mention",
            user: "UASKER",
            text: "<@UBOT> hi",
            channel: "C1",
            ts: "2.2",
          },
        });
      expect(await (await send(event("T2", "EvOther1"))).json()).toEqual({
        challenge: null,
        accepted: false,
      });
      expect(await (await send(event("T1", "EvOwn1"))).json()).toEqual({
        challenge: null,
        accepted: true,
      });
      const keys = await h.system(h.a, (db) =>
        db
          .select({ key: kvStore.key })
          .from(kvStore)
          .where(
            sql`${kvStore.key} in ('slack-hook:EvOther1', 'slack-hook:EvOwn1')`,
          ),
      );
      expect(keys.map((row) => row.key)).toEqual(["slack-hook:EvOwn1"]);
    });

    it("never lets identify change a teammate's account", async () => {
      const email = `${h.owner}-cdp@identify.test`;
      const integrationId = await h.as(h.a, h.owner, async (db, actor) => {
        await db
          .delete(integrations)
          .where(eq(integrations.integrationType, "segment"));
        const [row] = await db
          .insert(integrations)
          .values({
            integrationType: "segment",
            status: "active",
            secrets: seal({ incomingSecret: "segment-secret" }),
            config: {},
            connectedByPrincipalId: actor.principalId,
            connectedAt: new Date(),
          })
          .returning({ id: integrations.id });
        await db
          .insert(userAttributeDefinitions)
          .values({ key: "plan", label: "Plan", type: "string" })
          .onConflictDoNothing();
        const [identity] = await db
          .insert(user)
          .values({ name: "Teammate", email, kaneoUserId: h.owner })
          .returning({ id: user.id });
        await db.insert(principal).values({
          userId: identity!.id,
          role: "user",
          type: "user",
          createdAt: new Date(),
        });
        return row!.id;
      });
      const raw = JSON.stringify({
        type: "identify",
        traits: { email, plan: "pro" },
      });
      const res = await signed(
        `/integrations/segment/${integrationId}/identify`,
        raw,
        {
          "x-signature": createHmac("sha1", "segment-secret")
            .update(raw)
            .digest("base64"),
        },
      );
      expect(await res.json()).toEqual({
        status: "unknown",
        principalId: null,
      });
    });
  });
});
