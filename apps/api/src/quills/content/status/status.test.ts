import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { asc, eq, inArray } from "drizzle-orm";
import { segments } from "../../../database/quills/schema/segments";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { StatusComponentId } from "@kaneo/ids";
import * as kaneo from "../../../database/schema";
import { principal, user } from "../../../database/quills/schema/auth";
import {
  statusComponentEvents,
  statusComponentGroups,
  statusComponents,
  statusSubscriptions,
} from "../../../database/quills/schema/status";
import quillsRouter from "../../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
  type ContractEnv,
} from "../../framework/contract";
import { call } from "../../feedback/taxonomy-harness.fixture";
import { uptimeDays } from "./overview";
import { statusIn } from "./seed.fixture";

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
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter);
const send = (method: string, path: string, body?: unknown) => {
  const env = contractEnv();
  return call(app, env, env.owner, method, path, body);
};
const statusOf = (env: ContractEnv, ids: StatusComponentId[]) =>
  env.scoped(env.a, async (db) =>
    Object.fromEntries(
      (
        await db
          .select({ id: statusComponents.id, status: statusComponents.status })
          .from(statusComponents)
          .where(inArray(statusComponents.id, ids))
      ).map((row) => [row.id, row.status]),
    ),
  );

describe.skipIf(!url)("Quills status page", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  // The workspace delete cascades over the export test's 15,000 bulk rows: about 10 s under load.
  afterAll(() => stopContract(), 60000);

  it("applies and restores component statuses through the incident lifecycle", async () => {
    const env = contractEnv();
    const { otherComponentId: web } = await statusIn(env, env.a);
    const open = (componentStatus: string) =>
      send("POST", "/status/incidents", {
        kind: "incident",
        title: "Errors",
        status: "investigating",
        affectedComponents: [{ componentId: web, componentStatus }],
        body: "Looking",
      });
    const minor = await open("degraded_performance");
    expect(minor.body).toMatchObject({
      impact: "minor",
      notifySubscribers: true,
    });
    expect(minor.body.notifiedAt).not.toBeNull();
    const major = await open("major_outage");
    expect(await statusOf(env, [web])).toEqual({ [web]: "major_outage" });

    // Resolving the worse incident leaves the one still open in charge.
    const resolved = await send(
      "POST",
      `/status/incidents/${major.body.id}/updates`,
      {
        status: "resolved",
        body: "Fixed",
      },
    );
    expect(resolved.body).toMatchObject({
      status: "resolved",
      previousStatus: "investigating",
    });
    expect(resolved.body.resolvedAt).not.toBeNull();
    expect(await statusOf(env, [web])).toEqual({
      [web]: "degraded_performance",
    });

    // Reopening holds the component again; deleting releases it.
    await send("POST", `/status/incidents/${major.body.id}/updates`, {
      status: "identified",
      body: "Back",
    });
    expect(await statusOf(env, [web])).toEqual({ [web]: "major_outage" });
    await send("DELETE", `/status/incidents/${major.body.id}`);
    expect(await statusOf(env, [web])).toEqual({
      [web]: "degraded_performance",
    });

    // A partial recovery keeps the component as it is.
    const partial = await send(
      "POST",
      `/status/incidents/${minor.body.id}/updates`,
      { status: "resolved", body: "Mostly fixed", skipRestore: true },
    );
    expect(partial).toMatchObject({
      status: 200,
      body: { status: "resolved" },
    });
    expect(await statusOf(env, [web])).toEqual({
      [web]: "degraded_performance",
    });

    const history = await env.scoped(env.a, (db) =>
      db
        .select({ status: statusComponentEvents.status })
        .from(statusComponentEvents)
        .where(eq(statusComponentEvents.componentId, web))
        .orderBy(asc(statusComponentEvents.createdAt)),
    );
    expect(history.map((row) => row.status)).toEqual([
      "degraded_performance",
      "major_outage",
      "degraded_performance",
      "major_outage",
      "degraded_performance",
    ]);
  });

  it("starts and completes a maintenance window", async () => {
    const env = contractEnv();
    const ids = await statusIn(env, env.a);
    const path = `/status/incidents/${ids.maintenanceId}`;
    expect(await statusOf(env, [ids.otherComponentId])).toEqual({
      [ids.otherComponentId]: "operational",
    });
    expect((await send("POST", `${path}/start`)).body).toMatchObject({
      status: "in_progress",
    });
    expect(await statusOf(env, [ids.otherComponentId])).toEqual({
      [ids.otherComponentId]: "under_maintenance",
    });
    expect((await send("POST", `${path}/start`)).status).toBe(409);
    await send("POST", `${path}/updates`, {
      status: "completed",
      body: "Done",
    });
    expect(await statusOf(env, [ids.otherComponentId])).toEqual({
      [ids.otherComponentId]: "operational",
    });
    // An incident status on a maintenance window is bad input.
    expect(
      (
        await send("POST", `${path}/updates`, {
          status: "resolved",
          body: "No",
        })
      ).status,
    ).toBe(400);
  });

  it("logs a past incident without touching components or notifying", async () => {
    const env = contractEnv();
    const ids = await statusIn(env, env.a);
    const base = {
      kind: "incident",
      title: "Last week",
      affectedComponents: [
        { componentId: ids.otherComponentId, componentStatus: "major_outage" },
      ],
      body: "Summary",
      backfill: {
        startedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        resolvedAt: new Date(Date.now() - 6 * 86400000).toISOString(),
      },
    };
    expect(
      (
        await send("POST", "/status/incidents", {
          ...base,
          status: "investigating",
        })
      ).status,
    ).toBe(400);
    const logged = await send("POST", "/status/incidents", {
      ...base,
      status: "resolved",
    });
    expect(logged.body).toMatchObject({
      backfilled: true,
      notifiedAt: null,
      notifySubscribers: false,
    });
    expect(await statusOf(env, [ids.otherComponentId])).toEqual({
      [ids.otherComponentId]: "operational",
    });
    const [event] = (
      await pool.query(
        "SELECT type FROM quills.events WHERE workspace_id=$1 AND entity_id=$2",
        [env.a, logged.body.id],
      )
    ).rows;
    expect(event.type).toBe("status.incident_created");
  });

  it("rejects components and templates of another workspace in nested fields", async () => {
    const env = contractEnv();
    const ids = await statusIn(env, env.a);
    const foreign = await statusIn(env, env.b);
    const before = await statusOf(env, [ids.componentId]);
    expect(
      (
        await send("POST", "/status/incidents", {
          kind: "incident",
          title: "Errors",
          status: "investigating",
          affectedComponents: [
            {
              componentId: foreign.componentId,
              componentStatus: "major_outage",
            },
          ],
          body: "Looking",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send("PATCH", `/status/incidents/${ids.incidentId}`, {
          affectedComponents: [
            {
              componentId: foreign.componentId,
              componentStatus: "major_outage",
            },
          ],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send("POST", "/status/templates", {
          name: "X",
          title: "X",
          body: "X",
          componentIds: [foreign.componentId],
        })
      ).status,
    ).toBe(404);
    expect(
      (await send("GET", `/status/uptime?componentIds=${foreign.componentId}`))
        .body,
    ).toEqual({ series: [] });
    expect(await statusOf(env, [ids.componentId])).toEqual(before);
    // The other workspace's component is untouched.
    const [theirs] = await env.scoped(env.b, (db) =>
      db
        .select({ status: statusComponents.status })
        .from(statusComponents)
        .where(eq(statusComponents.id, foreign.componentId)),
    );
    expect(theirs!.status).toBe("partial_outage");
  });

  it("reorders components and groups all or nothing", async () => {
    const env = contractEnv();
    await statusIn(env, env.a);
    await statusIn(env, env.a);
    const foreign = await statusIn(env, env.b);
    type Node = { id: string; components: { id: string }[] };
    const tree = (await send("GET", "/status/components")).body;
    const cases = [
      {
        path: "/status/components/order",
        field: "componentIds",
        ids: [
          ...tree.groups.flatMap((g: Node) => g.components),
          ...tree.ungrouped,
        ].map((c: { id: string }) => c.id),
        foreignId: foreign.componentId,
        table: statusComponents,
      },
      {
        path: "/status/groups/order",
        field: "groupIds",
        ids: tree.groups.map((g: Node) => g.id),
        foreignId: foreign.groupId,
        table: statusComponentGroups,
      },
    ] as const;
    for (const c of cases) {
      const put = (list: string[]) => send("PUT", c.path, { [c.field]: list });
      const ids: string[] = c.ids;
      expect((await put(ids.slice(1))).status).toBe(409);
      expect((await put([c.foreignId, ...ids.slice(1)])).status).toBe(404);
      expect((await put([ids[0]!, ids[0]!, ...ids.slice(2)])).status).toBe(400);
      const reversed = [...ids].reverse();
      expect((await put(reversed)).status).toBe(200);
      const stored = await env.scoped(env.a, (db) =>
        db.select({ id: c.table.id, position: c.table.position }).from(c.table),
      );
      for (const row of stored.filter((r) => ids.includes(r.id)))
        expect(row.position).toBe(reversed.indexOf(row.id));
    }
  });

  it("imports at most 5000 emails and keeps opted-out people out", async () => {
    const env = contractEnv();
    const ids = await statusIn(env, env.a);
    const tooMany = Array.from(
      { length: 5001 },
      (_, i) => `p${i}@example.test`,
    );
    const before = await env.scoped(env.a, (db) =>
      db.select().from(statusSubscriptions),
    );
    expect(
      (await send("POST", "/status/subscribers/import", { emails: tooMany }))
        .status,
    ).toBe(400);
    expect(
      await env.scoped(env.a, (db) => db.select().from(statusSubscriptions)),
    ).toEqual(before);

    expect(
      (await send("DELETE", `/status/subscribers/${ids.principalId}`)).body,
    ).toEqual({
      principalId: ids.principalId,
      removed: true,
    });
    expect(
      (
        await send("POST", "/status/subscribers/import", {
          emails: [ids.email.toUpperCase(), "nobody@example.test"],
        })
      ).body,
    ).toEqual({ imported: 0, skipped: 1, optedOut: 1, total: 2 });
    expect(
      (await send("POST", "/status/subscribers", { email: ids.email })).body,
    ).toEqual({
      principalId: ids.principalId,
      subscribed: false,
    });
  });

  it("refuses an export above 5000 subscribers", async () => {
    const env = contractEnv();
    await env.scoped(env.a, async (db) => {
      const people = await db
        .insert(user)
        .values(
          Array.from({ length: 5001 }, (_, i) => ({
            name: `Bulk ${i}`,
            email: `${env.id("bulk")}-${i}@example.test`,
          })),
        )
        .returning({ id: user.id });
      const principals = await db
        .insert(principal)
        .values(people.map((p) => ({ userId: p.id, createdAt: new Date() })))
        .returning({ id: principal.id });
      await db.insert(statusSubscriptions).values(
        principals.map((p) => ({
          principalId: p.id,
          source: "csv_import" as const,
        })),
      );
    });
    await pool.query("ANALYZE quills.status_subscriptions");
    expect((await send("GET", "/status/subscribers/export")).status).toBe(409);
    expect(
      (await send("GET", "/status/subscribers?limit=100")).body.subscribers,
    ).toHaveLength(100);
    // Seeding 15,000 rows takes about 4 s locally, above the default 5 s budget with the requests.
  }, 60000);

  it("starts the uptime window from the last status before it", async () => {
    const env = contractEnv();
    const { componentId, otherComponentId } = await statusIn(env, env.a);
    await env.scoped(env.a, (db) =>
      db.insert(statusComponentEvents).values([
        {
          componentId,
          status: "degraded_performance",
          source: "manual",
          createdAt: new Date(Date.now() - 200 * 86400000),
        },
        {
          componentId,
          status: "major_outage",
          source: "manual",
          createdAt: new Date(Date.now() - 100 * 86400000),
        },
      ]),
    );
    const { body } = await send(
      "GET",
      `/status/uptime?componentIds=${componentId},${otherComponentId}&windowDays=3`,
    );
    const series = Object.fromEntries(
      body.series.map((s: { componentId: string; days: unknown[] }) => [
        s.componentId,
        s.days,
      ]),
    );
    expect(series[componentId]).toHaveLength(3);
    for (const day of series[componentId])
      expect(day).toMatchObject({ worstStatus: "major_outage", uptimePct: 0 });
    for (const day of series[otherComponentId])
      expect(day).toMatchObject({ worstStatus: "operational", uptimePct: 100 });
  });

  it("rejects segments and components of another workspace in ID lists", async () => {
    const env = contractEnv();
    const ids = await statusIn(env, env.a);
    const foreign = await statusIn(env, env.b);
    const [segment] = await env.scoped(env.b, (db) =>
      db
        .insert(segments)
        .values({ name: "B only", slug: env.id("segment") })
        .returning({ id: segments.id }),
    );
    const segmentIds = [segment!.id];
    for (const [method, path, body] of [
      ["PATCH", "/status/settings", { allowedSegmentIds: segmentIds }],
      ["POST", "/status/components", { name: "X", segmentIds }],
      ["PATCH", `/status/components/${ids.componentId}`, { segmentIds }],
      [
        "PATCH",
        `/status/templates/${ids.templateId}`,
        { componentIds: [foreign.componentId] },
      ],
    ] as const)
      expect((await send(method, path, body)).status).toBe(404);
    expect(
      (await send("GET", "/status/settings")).body.allowedSegmentIds,
    ).toEqual([]);
  });

  it("replaces an open incident's components and releases the removed ones", async () => {
    const env = contractEnv();
    const { componentId: api, otherComponentId: web } = await statusIn(
      env,
      env.a,
    );
    const created = await send("POST", "/status/incidents", {
      kind: "incident",
      title: "Errors",
      status: "investigating",
      affectedComponents: [
        { componentId: web, componentStatus: "major_outage" },
      ],
      body: "Looking",
    });
    const path = `/status/incidents/${created.body.id}`;
    const moved = await send("PATCH", path, {
      affectedComponents: [
        { componentId: api, componentStatus: "major_outage" },
      ],
    });
    expect(moved.body.affectedComponents).toEqual([
      expect.objectContaining({
        componentId: api,
        componentStatus: "major_outage",
      }),
    ]);
    expect(moved.body.detailsEditedAt).not.toBeNull();
    expect(await statusOf(env, [api, web])).toEqual({
      [api]: "major_outage",
      [web]: "operational",
    });
    // Only deleted components left in the list is bad input.
    await send("DELETE", `/status/components/${web}`);
    expect(
      (
        await send("PATCH", path, {
          affectedComponents: [
            { componentId: web, componentStatus: "major_outage" },
          ],
        })
      ).status,
    ).toBe(400);
  });

  it("unschedules a running window and dates its first real start", async () => {
    const env = contractEnv();
    const ids = await statusIn(env, env.a);
    const path = `/status/incidents/${ids.maintenanceId}`;
    const post = (status: string) =>
      send("POST", `${path}/updates`, { status, body: status });
    // A window planned in the past that keeps its automation on a plain note.
    const past = new Date(Date.now() - 3600000).toISOString();
    await send("PATCH", path, { scheduledStartAt: past, autoStart: true });
    expect((await post("scheduled")).body).toMatchObject({ autoStart: true });

    await send("POST", `${path}/start`);
    const unscheduled = await post("scheduled");
    expect(unscheduled.body).toMatchObject({
      status: "scheduled",
      autoStart: false,
    });
    expect(new Date(unscheduled.body.startedAt).toISOString()).toBe(past);
    expect(await statusOf(env, [ids.otherComponentId])).toEqual({
      [ids.otherComponentId]: "operational",
    });

    // Completed early, then begun: the first begun update after the plan dates the start.
    const other = await statusIn(env, env.a);
    const second = `/status/incidents/${other.maintenanceId}`;
    await send("PATCH", second, { scheduledStartAt: past });
    await send("POST", `${second}/updates`, {
      status: "completed",
      body: "Skipped",
    });
    const begun = await send("POST", `${second}/updates`, {
      status: "in_progress",
      body: "Now",
    });
    expect(new Date(begun.body.startedAt).getTime()).toBeGreaterThan(
      Date.parse(past) + 1000,
    );
  });

  it("refuses to reopen a logged past incident", async () => {
    const env = contractEnv();
    const ids = await statusIn(env, env.a);
    const logged = await send("POST", "/status/incidents", {
      kind: "incident",
      title: "Last week",
      status: "resolved",
      affectedComponents: [
        { componentId: ids.otherComponentId, componentStatus: "major_outage" },
      ],
      body: "Summary",
      backfill: {
        startedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        resolvedAt: new Date(Date.now() - 6 * 86400000).toISOString(),
      },
    });
    expect(
      (
        await send("POST", `/status/incidents/${logged.body.id}/updates`, {
          status: "investigating",
          body: "Again",
        })
      ).status,
    ).toBe(409);
  });

  it("subscribes a matching customer who had no subscription", async () => {
    const env = contractEnv();
    const email = `${env.id("fresh")}@example.test`;
    const personId = await env.scoped(env.a, async (db) => {
      const [identity] = await db
        .insert(user)
        .values({ name: "Fresh", email })
        .returning({ id: user.id });
      const [row] = await db
        .insert(principal)
        .values({ userId: identity!.id, createdAt: new Date() })
        .returning({ id: principal.id });
      return row!.id;
    });
    expect(
      (await send("POST", "/status/subscribers/import", { emails: [email] }))
        .body,
    ).toEqual({ imported: 1, skipped: 0, optedOut: 0, total: 1 });
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({
          source: statusSubscriptions.source,
          scope: statusSubscriptions.scope,
        })
        .from(statusSubscriptions)
        .where(eq(statusSubscriptions.principalId, personId)),
    );
    expect(row).toEqual({ source: "csv_import", scope: "page" });
  });

  it("clears resolved items and the status log, and keeps open items", async () => {
    const env = contractEnv();
    const ids = await statusIn(env, env.a);
    await send("PATCH", `/status/components/${ids.componentId}`, {
      status: "major_outage",
    });
    await send("POST", `/status/incidents/${ids.incidentId}/updates`, {
      status: "resolved",
      body: "Fixed",
    });
    const res = await send("POST", "/status/history/clear");
    expect(res.status).toBe(200);
    expect(res.body.incidents).toBeGreaterThanOrEqual(1);
    expect(
      (await send("GET", `/status/incidents/${ids.incidentId}`)).status,
    ).toBe(404);
    expect(
      (await send("GET", `/status/incidents/${ids.maintenanceId}`)).status,
    ).toBe(200);
    const left = await env.scoped(env.a, (db) =>
      db.select().from(statusComponentEvents),
    );
    expect(left).toEqual([]);
  });

  it("derives daily uptime from the status log", () => {
    const now = new Date("2026-01-03T12:00:00Z");
    const days = uptimeDays(
      [
        { status: "major_outage", createdAt: new Date("2026-01-02T00:00:00Z") },
        { status: "operational", createdAt: new Date("2026-01-02T06:00:00Z") },
      ],
      "operational",
      3,
      now,
    );
    expect(days).toEqual([
      { date: "2026-01-01", worstStatus: "operational", uptimePct: 100 },
      { date: "2026-01-02", worstStatus: "major_outage", uptimePct: 75 },
      { date: "2026-01-03", worstStatus: "operational", uptimePct: 100 },
    ]);
  });
});
