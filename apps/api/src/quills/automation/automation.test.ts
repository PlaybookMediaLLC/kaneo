import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { conversationTags } from "../../database/quills/schema/conversation";
import { teams } from "../../database/quills/schema/teams";
import { workflows } from "../../database/quills/schema/workflows";
import * as kaneo from "../../database/schema";
import { contractApp } from "../framework/contract";
import quillsRouter from "../index";
import { harness } from "../jobs/handlers/harness.fixture";
import { conversation, customer } from "../support/conversation-seed.fixture";
import { evaluate, walk, type ConditionContext } from "./graph";
import { prepareArchive } from "../transfer/import-archive";
import { tagGraph } from "./seed.fixture";

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

const ctx: ConditionContext = {
  conversation: {
    status: "open",
    channel: "email",
    priority: "high",
    tagIds: ["tag_a"],
    teamId: null,
    attributes: { plan: { v: "pro", src: "agent" }, seats: 12 },
  },
  message: { body: "The invoice is wrong", sender: "visitor" },
};

describe("workflow conditions and walk", () => {
  it("evaluates leaves and groups like the source", () => {
    const yes = [
      { field: "conversation.priority", op: "eq", value: "high" },
      { field: "conversation.attr.plan", op: "eq", value: "pro" },
      { field: "conversation.attr.seats", op: "gte", value: "10" },
      { field: "conversation.attr.seats", op: "eq", value: "12" },
      {
        field: "message.body",
        op: "contains_any",
        values: ["refund", "INVOICE"],
      },
      { field: "conversation.tags", op: "includes_any", values: ["tag_a"] },
      { field: "conversation.team", op: "is_empty" },
      {
        all: [{ field: "conversation.status", op: "eq", value: "open" }],
        any: [],
      },
    ];
    for (const condition of yes) expect(evaluate(condition, ctx)).toBe(true);
    const no = [
      // An unknown attribute matches no negative operator.
      { field: "conversation.attr.missing", op: "neq", value: "x" },
      { field: "conversation.attr.missing", op: "excludes_all", values: ["x"] },
      {
        field: "message.body",
        op: "contains_all",
        values: ["invoice", "refund"],
      },
      { field: "message.body", op: "contains_any", values: [] },
      { field: "conversation.priority", op: "gt", value: "x" },
      {
        any: [
          { field: "conversation.channel", op: "eq", value: "chat" },
          {
            all: [{ field: "conversation.status", op: "eq", value: "closed" }],
          },
        ],
      },
      null,
      // A single-value operator with a list, or a malformed group, never matches.
      { field: "conversation.status", op: "neq", values: ["open"] },
      { field: "message.body", op: "not_contains", values: ["refund"] },
      { field: "conversation.status", op: "neq" },
      { all: "x" },
    ];
    for (const condition of no) expect(evaluate(condition, ctx)).toBe(false);
  });

  it("walks branches and gates, and stops on a cycle, an unknown step or a bad action", () => {
    const close = { type: "close" };
    const graph = (nodes: object[], edges: object[]) => ({ nodes, edges });
    const branchy = graph(
      [
        { id: "t", type: "trigger" },
        {
          id: "b",
          type: "branch",
          branches: [
            {
              key: "low",
              condition: {
                field: "conversation.priority",
                op: "eq",
                value: "low",
              },
            },
            {
              key: "high",
              condition: {
                field: "conversation.priority",
                op: "eq",
                value: "high",
              },
            },
          ],
        },
        { id: "x", type: "action", action: { type: "reopen" } },
        { id: "y", type: "action", action: close },
      ],
      [
        { from: "t", to: "b" },
        { from: "b", to: "x", branch: "low" },
        { from: "b", to: "y", branch: "high" },
        { from: "y", to: "t" },
      ],
    );
    expect(walk(branchy, ctx)).toEqual({
      actions: [close],
      status: "completed",
    });
    const gated = graph(
      [
        { id: "t", type: "trigger" },
        {
          id: "c",
          type: "condition",
          condition: {
            field: "conversation.status",
            op: "eq",
            value: "closed",
          },
        },
        { id: "y", type: "action", action: close },
      ],
      [
        { from: "t", to: "c" },
        { from: "c", to: "y" },
      ],
    );
    expect(walk(gated, ctx)).toEqual({ actions: [], status: "halted" });
    const waiting = graph(
      [
        { id: "t", type: "trigger" },
        { id: "y", type: "action", action: close },
        { id: "w", type: "wait", seconds: 60 },
        {
          id: "z",
          type: "action",
          action: { type: "assign_team", teamId: "not-an-id" },
        },
      ],
      [
        { from: "t", to: "y" },
        { from: "y", to: "w" },
        { from: "w", to: "z" },
      ],
    );
    expect(walk(waiting, ctx)).toEqual({ actions: [close], status: "halted" });
    expect(walk(null, ctx)).toEqual({ actions: [], status: "completed" });
    expect(
      walk(
        { nodes: [null, { id: "t", type: "trigger" }, 7], edges: [null] },
        ctx,
      ),
    ).toEqual({ actions: [], status: "completed" });
  });

  it("pauses an imported live workflow", () => {
    const result = prepareArchive(
      {
        format: "quills-workspace",
        version: 1,
        origin: "quackback",
        createdAt: new Date().toISOString(),
        tables: {
          workflows: [
            { id: "live", status: "live" },
            { id: "draft", status: "draft" },
          ],
        },
        storageKeys: [],
        omittedTables: [],
      },
      {},
      "target",
      [],
    );
    expect(result.tables.workflows!.map((row) => row.status)).toEqual([
      "paused",
      "draft",
    ]);
  });
});

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("automation");
const app = contractApp(quillsRouter);
const send = async (
  user: string,
  method: string,
  path: string,
  body?: unknown,
  workspace = h.a,
) => {
  const res = await app.request(`/quills/${workspace}${path}`, {
    method,
    headers: {
      "x-test-user": user,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe.skipIf(!url)("workflow routes", () => {
  let tags: { a: string; archived: string; b: string };
  let foreign: { teamId: string; principalId: string };
  let conversationId: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await h.start(pool, url!);
    const b = await h.as(h.b, h.outsider, async (db, actor) => {
      const [tag] = await db
        .insert(conversationTags)
        .values({ name: `b-${Date.now()}` })
        .returning({ id: conversationTags.id });
      const [team] = await db
        .insert(teams)
        .values({ name: `b-${Date.now()}` })
        .returning({ id: teams.id });
      foreign = { teamId: team!.id, principalId: actor.principalId };
      return tag!.id as string;
    });
    const a = await h.as(h.a, h.owner, async (db, actor) => {
      const [tag, archived] = await db
        .insert(conversationTags)
        .values([
          { name: `a-${Date.now()}` },
          { name: `old-${Date.now()}`, deletedAt: new Date() },
        ])
        .returning({ id: conversationTags.id });
      const visitor = await customer(db, `${Date.now()}@example.test`);
      conversationId = (await conversation(db, actor.principalId, visitor))
        .conversationId;
      return { tag: tag!.id as string, archived: archived!.id as string };
    });
    tags = { a: a.tag, archived: a.archived, b };
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  const create = (graph: object) =>
    send(h.owner, "POST", "/automation/workflows", {
      name: "Tagger",
      triggerType: "message.created",
      graph,
    });

  it("checks every ID an action names against this workspace", async () => {
    expect((await create(tagGraph(tags.b))).status).toBe(404);
    expect((await create(tagGraph(tags.archived))).status).toBe(404);
    const created = await create(tagGraph(tags.a));
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      status: "draft",
      class: "background",
    });
    // A foreign tag cannot come in through an update or another workspace's caller.
    const update = await send(
      h.owner,
      "PATCH",
      `/automation/workflows/${created.body.id}`,
      {
        graph: tagGraph(tags.b),
      },
    );
    expect(update.status).toBe(404);
    const foreign = await send(
      h.outsider,
      "GET",
      `/automation/workflows/${created.body.id}`,
      undefined,
      h.b,
    );
    expect(foreign.status).toBe(404);
  });

  it("checks the teammates and teams that actions name", async () => {
    const one = (action: object) => ({
      nodes: [
        { id: "t", type: "trigger" },
        { id: "a", type: "action", action },
      ],
      edges: [{ from: "t", to: "a" }],
    });
    expect(
      (await create(one({ type: "assign_team", teamId: foreign.teamId })))
        .status,
    ).toBe(404);
    expect(
      (
        await create(
          one({ type: "assign_agent", principalId: foreign.principalId }),
        )
      ).status,
    ).toBe(404);
    const mate = await h.principal(h.a, h.mate);
    expect(
      (await create(one({ type: "assign_agent", principalId: mate }))).status,
    ).toBe(200);
  });

  it("rejects steps, fields and edges the engine cannot run", async () => {
    const bad = [
      { nodes: [{ id: "w", type: "wait", seconds: 60 }], edges: [] },
      {
        nodes: [
          {
            id: "c",
            type: "condition",
            condition: { field: "person.email", op: "is_set" },
          },
        ],
        edges: [],
      },
      {
        nodes: [{ id: "t", type: "trigger" }],
        edges: [{ from: "t", to: "missing" }],
      },
      {
        nodes: [
          {
            id: "c",
            type: "condition",
            condition: {
              field: "conversation.status",
              op: "neq",
              values: ["open"],
            },
          },
        ],
        edges: [],
      },
      {
        nodes: [
          { id: "t", type: "trigger" },
          { id: "t", type: "trigger" },
        ],
        edges: [],
      },
    ];
    for (const graph of bad) expect((await create(graph)).status).toBe(400);
  });

  it("restores only the workflow's own version, and publishing records the caller", async () => {
    const first = await create(tagGraph(tags.a));
    const second = await create(tagGraph(tags.a));
    const versions = await send(
      h.owner,
      "GET",
      `/automation/workflows/${first.body.id}/versions`,
    );
    const versionId = versions.body.versions[0].id;
    expect(
      (
        await send(
          h.owner,
          "POST",
          `/automation/workflows/${second.body.id}/versions/${versionId}/restore`,
        )
      ).status,
    ).toBe(404);
    const published = await send(
      h.owner,
      "POST",
      `/automation/workflows/${first.body.id}/publish`,
    );
    const owner = await h.principal(h.a, h.owner);
    expect(published.body).toMatchObject({
      status: "live",
      actorPrincipalId: owner,
    });
    const after = await send(
      h.owner,
      "GET",
      `/automation/workflows/${first.body.id}/versions`,
    );
    expect(after.body.versions).toHaveLength(2);
    expect(after.body.versions[0].createdBy).toBe(owner);
  });

  it("refuses to publish a stored graph that no longer validates", async () => {
    const created = await create(tagGraph(tags.a));
    await h.system(h.a, (db) =>
      db
        .update(workflows)
        .set({
          graph: { nodes: [{ id: "w", type: "wait", seconds: 5 }], edges: [] },
        })
        .where(eq(workflows.id, created.body.id)),
    );
    const published = await send(
      h.owner,
      "POST",
      `/automation/workflows/${created.body.id}/publish`,
    );
    expect(published.status).toBe(409);
  });

  it("previews without changing anything, and a reorder must name every workflow", async () => {
    const created = await create(tagGraph(tags.a));
    const preview = await send(
      h.owner,
      "GET",
      `/automation/workflows/${created.body.id}/preview?conversationId=${conversationId}`,
    );
    expect(preview.body).toEqual({
      status: "completed",
      actions: [{ type: "add_tag", tagId: tags.a }],
    });
    const partial = await send(h.owner, "PUT", "/automation/workflows/order", {
      workflowIds: [created.body.id],
    });
    expect(partial.status).toBe(409);
  });
});
