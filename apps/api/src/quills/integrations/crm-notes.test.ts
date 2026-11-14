import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { IntegrationId, PostId, PrincipalId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { companies } from "../../database/quills/schema/companies";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { hookDeliveries } from "../../database/quills/schema/hook-deliveries";
import { integrations } from "../../database/quills/schema/integrations";
import { jobQueue } from "../../database/quills/schema/job-queue";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { sealCredentials } from "../framework/integration-config";
import { harness } from "../jobs/handlers/harness.fixture";
import {
  providerAnswers,
  providerCalls,
  providerOverrides,
} from "./provider-edge.fixture";

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
vi.mock("../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("crmnote");
process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "quills-crm-note-test-key";
const HUBSPOT_NOTES = "/api.hubapi.com/crm/v3/objects/notes";
const SALESFORCE_NOTES =
  "/contract.my.salesforce.com/services/data/v62.0/sobjects/Note";
const SECRETS = ["hubspot-secret-token", "salesforce-secret-token"];
providerAnswers.push(
  (route) =>
    ({
      [`POST ${HUBSPOT_NOTES}`]: { id: "9001" },
      [`POST ${SALESFORCE_NOTES}`]: { id: "002000000000001AAA", success: true },
    })[route],
);
const calls = (path: string) =>
  providerCalls.filter((call) => call.path === path);
const logged = vi.spyOn(console, "error").mockImplementation(() => {});

let seq = 0;
let postId: PostId;
const connections: Partial<Record<string, IntegrationId>> = {};

/** An active CRM connection in workspace A. */
async function connect(type: "hubspot" | "salesforce") {
  connections[type] = await h.system(h.a, async (db) => {
    const [row] = await db
      .insert(integrations)
      .values({
        integrationType: type,
        status: "active",
        secrets: sealCredentials({ accessToken: `${type}-secret-token` }),
        config:
          type === "salesforce"
            ? { instanceUrl: "https://contract.my.salesforce.com" }
            : { portalId: "42" },
        connectedAt: new Date(),
      })
      .returning({ id: integrations.id });
    return row!.id;
  });
}
/** A customer of a company with this CRM ID (no company when undefined), with a vote on the post. */
async function voter(
  workspaceId: string,
  post: PostId,
  externalId: string | null | undefined,
  importance: "critical" | "important" = "critical",
) {
  return h.system(workspaceId, async (db) => {
    const [company] =
      externalId === undefined
        ? []
        : await db
            .insert(companies)
            .values({ name: `Acme ${++seq}`, externalId })
            .returning({ id: companies.id });
    const [person] = await db
      .insert(principal)
      .values({
        type: "user",
        role: "user",
        displayName: "Grace Hopper",
        companyId: company?.id ?? null,
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    const [vote] = await db
      .insert(postVotes)
      .values({ postId: post, principalId: person!.id, importance })
      .returning({ id: postVotes.id });
    return {
      principalId: person!.id,
      voteId: vote!.id,
      companyId: company?.id,
    };
  });
}
async function post(workspaceId: string) {
  const owner = await h.principal(
    workspaceId,
    workspaceId === h.a ? h.owner : h.outsider,
  );
  return h.system(workspaceId, async (db) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Ideas board", slug: `ideas-${++seq}` })
      .returning({ id: boards.id });
    const [row] = await db
      .insert(posts)
      .values({
        title: "Dark <mode>",
        content: "Please",
        boardId: board!.id,
        principalId: owner,
      })
      .returning({ id: posts.id });
    return row!.id;
  });
}
const voted = (
  workspaceId: string,
  principalId: PrincipalId,
  importance = "critical",
) =>
  h.emit(workspaceId, {
    type: "post.vote_importance_set",
    entityType: "post",
    entityId: postId,
    payload: { importance, principalId },
  });
const noteJobs = (workspaceId: string, eventId: string) =>
  h.system(workspaceId, (db) =>
    db
      .select()
      .from(jobQueue)
      .where(
        and(
          eq(jobQueue.queue, "quills.webhook"),
          eq(jobQueue.dedupeKey, `${eventId}:crm-note`),
        ),
      ),
  );
const ledger = (key: string) =>
  h.system(h.a, async (db) => {
    const [row] = await db
      .select({ outcome: hookDeliveries.outcome })
      .from(hookDeliveries)
      .where(eq(hookDeliveries.jobId, key));
    return row?.outcome;
  });
const crmLedger = () =>
  h.system(h.a, (db) =>
    db
      .select()
      .from(hookDeliveries)
      .where(like(hookDeliveries.jobId, "crm-note:%")),
  );
const health = (id: IntegrationId) =>
  h.system(h.a, async (db) => {
    const [row] = await db
      .select({
        lastError: integrations.lastError,
        lastOutboundAt: integrations.lastOutboundAt,
      })
      .from(integrations)
      .where(eq(integrations.id, id));
    return row!;
  });
/** No secret in a job error, a connection error or a log line. */
async function noSecretsLeaked() {
  const text = JSON.stringify([
    await h.system(h.a, (db) =>
      db.select({ error: jobQueue.lastError }).from(jobQueue),
    ),
    await h.system(h.a, (db) =>
      db.select({ error: integrations.lastError }).from(integrations),
    ),
    logged.mock.calls.map((args) => args.map(String)),
  ]);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe.skipIf(!url)("Quills CRM notes", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    await connect("hubspot");
    await connect("salesforce");
    postId = await post(h.a);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });
  afterEach(async () => {
    providerOverrides.clear();
    providerCalls.length = 0;
    await noSecretsLeaked();
  });

  it("adds one HubSpot note for a critical vote of a mapped company", async () => {
    const vote = await voter(h.a, postId, "123456");
    const eventId = await voted(h.a, vote.principalId);
    await h.drain(h.a);
    const [call] = calls(HUBSPOT_NOTES);
    expect(calls(HUBSPOT_NOTES)).toHaveLength(1);
    expect(call!.authorization).toBe("Bearer hubspot-secret-token");
    const body = JSON.parse(call!.body);
    expect(body.associations).toEqual([
      {
        to: { id: "123456" },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 190 },
        ],
      },
    ]);
    const note: string = body.properties.hs_note_body;
    for (const part of [
      "Feature request: Dark &lt;mode&gt;",
      "Board: Ideas board",
      "Customer: Grace Hopper",
      "Importance: critical",
      `/posts/${postId}`,
    ])
      expect(note).toContain(part);
    expect(await ledger(`crm-note:${vote.voteId}:${vote.companyId}`)).toBe(
      "completed",
    );
    expect((await health(connections.hubspot!)).lastOutboundAt).not.toBeNull();
    expect(calls(SALESFORCE_NOTES)).toEqual([]);

    // A replayed job and a second critical event for the same vote send nothing.
    const [job] = await noteJobs(h.a, eventId);
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({ status: "pending", attempts: 0, runAt: new Date(0) })
        .where(eq(jobQueue.id, job!.id)),
    );
    await voted(h.a, vote.principalId);
    await h.drain(h.a);
    expect(calls(HUBSPOT_NOTES)).toHaveLength(1);
  });

  it("sends and records nothing without a company mapping", async () => {
    const before = (await crmLedger()).length;
    for (const externalId of [undefined, null, "cus_123", "0123"]) {
      const vote = await voter(h.a, postId, externalId);
      await voted(h.a, vote.principalId);
    }
    await h.drain(h.a);
    expect(providerCalls).toEqual([]);
    expect(await crmLedger()).toHaveLength(before);
  });

  it("queues nothing for an important vote or a workspace without a CRM", async () => {
    const important = await voter(h.a, postId, "222222", "important");
    const quiet = await voted(h.a, important.principalId, "important");
    const foreignPost = await post(h.b);
    const foreign = await voter(h.b, foreignPost, "333333");
    const elsewhere = await h.emit(h.b, {
      type: "post.vote_importance_set",
      entityType: "post",
      entityId: foreignPost,
      payload: { importance: "critical", principalId: foreign.principalId },
    });
    await h.drain(h.a);
    await h.drain(h.b);
    expect(await noteJobs(h.a, quiet)).toEqual([]);
    expect(await noteJobs(h.b, elsewhere)).toEqual([]);
    expect(providerCalls).toEqual([]);
  });

  it("retries a busy provider with the job backoff and sends once", async () => {
    const vote = await voter(h.a, postId, "444444");
    const key = `crm-note:${vote.voteId}:${vote.companyId}`;
    providerOverrides.set(`POST ${HUBSPOT_NOTES}`, {
      status: 429,
      body: { message: "hubspot-secret-token rate limited" },
    });
    const eventId = await voted(h.a, vote.principalId);
    await h.drain(h.a);
    const [waiting] = await noteJobs(h.a, eventId);
    expect(waiting).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "CRM note unavailable",
    });
    expect(await ledger(key)).toBe("failed");
    expect((await health(connections.hubspot!)).lastError).toBe(
      "The provider was unavailable.",
    );
    await noSecretsLeaked();

    providerOverrides.clear();
    await h.due(h.a);
    await h.drain(h.a);
    expect(calls(HUBSPOT_NOTES)).toHaveLength(2);
    expect(await ledger(key)).toBe("completed");
    expect((await noteJobs(h.a, eventId))[0]!.status).toBe("succeeded");
    expect((await health(connections.hubspot!)).lastError).toBeNull();
  });

  it("does not send again after a call that may have created the note", async () => {
    const vote = await voter(h.a, postId, "555555");
    providerOverrides.set(`POST ${HUBSPOT_NOTES}`, { status: 502 });
    const eventId = await voted(h.a, vote.principalId);
    await h.drain(h.a);
    expect((await noteJobs(h.a, eventId))[0]).toMatchObject({
      status: "failed",
      lastError: "The CRM note may exist. It is not sent again.",
    });
    expect(await ledger(`crm-note:${vote.voteId}:${vote.companyId}`)).toBe(
      "uncertain",
    );
    providerOverrides.clear();
    await voted(h.a, vote.principalId);
    await h.due(h.a);
    await h.drain(h.a);
    expect(calls(HUBSPOT_NOTES)).toHaveLength(1);
  });

  it("adds one Salesforce note when a teammate links the post to an account", async () => {
    const account = "001000000000001AAA";
    await h.system(h.a, (db) =>
      db.insert(postExternalLinks).values({
        postId,
        integrationType: "salesforce",
        externalId: account,
        origin: "sidebar",
      }),
    );
    const linked = () =>
      h.emit(h.a, {
        type: "app.post_linked",
        entityType: "post",
        entityId: postId,
        payload: { externalType: "salesforce", externalKey: account },
      });
    await linked();
    await h.drain(h.a);
    const [call] = calls(SALESFORCE_NOTES);
    expect(call!.authorization).toBe("Bearer salesforce-secret-token");
    expect(JSON.parse(call!.body)).toMatchObject({
      ParentId: account,
      Title: "Feature request: Dark <mode>",
    });
    expect(JSON.parse(call!.body).Body).toContain("Board: Ideas board");
    await linked();
    await h.drain(h.a);
    expect(calls(SALESFORCE_NOTES)).toHaveLength(1);
    expect(calls(HUBSPOT_NOTES)).toEqual([]);
  });

  it("sends nothing for a link that a teammate removed before the job ran", async () => {
    const account = "001000000000002AAA";
    const eventId = await h.emit(h.a, {
      type: "app.post_linked",
      entityType: "post",
      entityId: postId,
      payload: { externalType: "salesforce", externalKey: account },
    });
    await h.drain(h.a);
    expect(await noteJobs(h.a, eventId)).toHaveLength(1);
    expect(providerCalls).toEqual([]);
  });
});
