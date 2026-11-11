import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import type { Database } from "../../database/quills/client";
import { auditLog } from "../../database/quills/schema/audit-log";
import { principal, user as customer } from "../../database/quills/schema/auth";
import {
  integrationSyncAttempts,
  integrationSyncOperations,
} from "../../database/quills/schema/integration-sync";
import { helpCenterSearchQueries } from "../../database/quills/schema/kb";
import { unsubscribeTokens } from "../../database/quills/schema/notifications";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import { statusSubscriptions } from "../../database/quills/schema/status";
import { mintWidgetSession } from "../framework/audience";
import { harness } from "./handlers/harness.fixture";
import { pruneQuillsWorkspace } from "./retention";

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
const h = harness("retention");
const ago = (days: number) => new Date(Date.now() - days * 86400000);
const prune = () => h.system(h.a, (db) => pruneQuillsWorkspace(db));
/** Workspace A, where retention runs, and workspace B, which it must not touch. */
const both = async <T>(
  seed: (db: Database, workspaceId: string) => Promise<T>,
) => ({
  a: await h.system(h.a, (db) => seed(db, h.a)),
  b: await h.system(h.b, (db) => seed(db, h.b)),
});
/** An anonymous widget visitor, as widget/feedback/session.ts creates one. */
const visitor = (db: Database, createdAt: Date, type = "anonymous") =>
  db
    .insert(customer)
    .values({ name: "Anonymous", isAnonymous: true })
    .returning({ id: customer.id })
    .then(async ([identity]) => {
      const [person] = await db
        .insert(principal)
        .values({ userId: identity!.id, role: "user", type, createdAt })
        .returning({ id: principal.id });
      return { principalId: person!.id, customerId: identity!.id };
    });
const present = (workspaceId: string) =>
  h.system(workspaceId, async (db) => ({
    principals: (await db.select({ id: principal.id }).from(principal)).map(
      (row) => row.id,
    ),
    customers: (await db.select({ id: customer.id }).from(customer)).map(
      (row) => row.id,
    ),
  }));
const owners = () => ({
  a: h.principal(h.a, h.owner),
  b: h.principal(h.b, h.outsider),
});

describe.skipIf(!url)("Quills retention", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  it("deletes help-center searches older than the log retention", async () => {
    await both((db) =>
      db.insert(helpCenterSearchQueries).values(
        [ago(91), ago(89)].map((createdAt, i) => ({
          query: `term ${i}`,
          normalizedQuery: `term ${i}`,
          locale: "en",
          resultsCount: 0,
          createdAt,
        })),
      ),
    );
    await prune();
    const terms = (workspaceId: string) =>
      h.system(workspaceId, (db) =>
        db
          .select({ query: helpCenterSearchQueries.query })
          .from(helpCenterSearchQueries)
          .orderBy(asc(helpCenterSearchQueries.query)),
      );
    expect(await terms(h.a)).toEqual([{ query: "term 1" }]);
    expect(await terms(h.b)).toEqual([
      { query: "term 0" },
      { query: "term 1" },
    ]);
  });

  it("deletes unsubscribe tokens 30 days after they expired or were used", async () => {
    const actors = owners();
    const principals = { a: await actors.a, b: await actors.b };
    const tokens = {
      expiredLongAgo: { expiresAt: ago(31), usedAt: null },
      usedLongAgo: { expiresAt: ago(-30), usedAt: ago(31) },
      expiredRecently: { expiresAt: ago(29), usedAt: null },
      usedRecently: { expiresAt: ago(-30), usedAt: ago(29) },
      live: { expiresAt: ago(-30), usedAt: null },
    };
    await both((db, workspaceId) =>
      db.insert(unsubscribeTokens).values(
        Object.entries(tokens).map(([token, times]) => ({
          token,
          principalId: workspaceId === h.a ? principals.a : principals.b,
          action: "unsubscribe_all",
          ...times,
        })),
      ),
    );
    await prune();
    const left = (workspaceId: string) =>
      h.system(workspaceId, (db) =>
        db
          .select({ token: unsubscribeTokens.token })
          .from(unsubscribeTokens)
          .orderBy(asc(unsubscribeTokens.token)),
      );
    expect((await left(h.a)).map((row) => row.token)).toEqual([
      "expiredRecently",
      "live",
      "usedRecently",
    ]);
    expect(await left(h.b)).toHaveLength(5);
  });

  it("deletes old sync attempts and keeps each operation, its key and its result", async () => {
    const seed = (db: Database) =>
      Promise.all(
        [ago(91), ago(89)].map(async (finishedAt, i) => {
          const [op] = await db
            .insert(integrationSyncOperations)
            .values({
              operationKey: `sync:${i}`,
              integrationId: "integration_retention",
              installation: "installation",
              provider: "linear",
              direction: "outbound",
              kind: "create",
              sourceType: "post",
              sourceId: `post_${i}`,
              destination: {},
              destinationKey: "team",
              state: "succeeded",
              result: { externalId: `EXT-${i}` },
              finishedAt,
            })
            .returning({ id: integrationSyncOperations.id });
          await db.insert(integrationSyncAttempts).values([
            {
              operationId: op!.id,
              number: 1,
              token: randomUUID(),
              state: "succeeded",
              finishedAt,
            },
            // A running attempt has no finish time and holds the lease.
            {
              operationId: op!.id,
              number: 2,
              token: randomUUID(),
              state: "running",
            },
          ]);
        }),
      );
    await both(seed);
    await prune();
    const state = (workspaceId: string) =>
      h.system(workspaceId, async (db) => ({
        operations: await db
          .select({
            key: integrationSyncOperations.operationKey,
            result: integrationSyncOperations.result,
          })
          .from(integrationSyncOperations)
          .orderBy(asc(integrationSyncOperations.operationKey)),
        attempts: await db
          .select({
            key: integrationSyncOperations.operationKey,
            number: integrationSyncAttempts.number,
          })
          .from(integrationSyncAttempts)
          .innerJoin(
            integrationSyncOperations,
            eq(
              integrationSyncOperations.id,
              integrationSyncAttempts.operationId,
            ),
          )
          .orderBy(
            asc(integrationSyncOperations.operationKey),
            asc(integrationSyncAttempts.number),
          ),
      }));
    expect(await state(h.a)).toEqual({
      operations: [
        { key: "sync:0", result: { externalId: "EXT-0" } },
        { key: "sync:1", result: { externalId: "EXT-1" } },
      ],
      attempts: [
        { key: "sync:0", number: 2 },
        { key: "sync:1", number: 1 },
        { key: "sync:1", number: 2 },
      ],
    });
    expect((await state(h.b)).attempts).toHaveLength(4);
  });

  it("deletes portal invites that ended before the log retention and keeps accepted ones", async () => {
    const invites = [
      ["expired@example.test", "expired", 91],
      ["canceled@example.test", "canceled", 91],
      ["unanswered@example.test", "pending", 91],
      ["accepted@example.test", "accepted", 91],
      ["recent@example.test", "expired", 89],
    ] as const;
    await both((db) =>
      db.insert(portalInvites).values(
        invites.map(([email, status, days]) => ({
          email,
          status,
          expiresAt: ago(days),
        })),
      ),
    );
    await prune();
    const left = (workspaceId: string) =>
      h.system(workspaceId, (db) =>
        db
          .select({ email: portalInvites.email })
          .from(portalInvites)
          .orderBy(asc(portalInvites.email)),
      );
    expect((await left(h.a)).map((row) => row.email)).toEqual([
      "accepted@example.test",
      "recent@example.test",
    ]);
    expect(await left(h.b)).toHaveLength(5);
  });

  it("deletes ended anonymous widget visitors only when nothing references them", async () => {
    const seed = async (db: Database) => {
      const ended = await visitor(db, ago(9));
      const subscribed = await visitor(db, ago(9));
      // A cascading foreign key: deleting the visitor would delete the subscription.
      await db
        .insert(statusSubscriptions)
        .values({ principalId: subscribed.principalId, source: "self_serve" });
      const audited = await visitor(db, ago(9));
      // A set-null foreign key: deleting the visitor would erase the actor.
      await db.insert(auditLog).values({
        eventType: "post.voted",
        actorPrincipalId: audited.principalId,
      });
      const session = await visitor(db, ago(9));
      await mintWidgetSession(db, session, "secret");
      const recent = await visitor(db, ago(1));
      const identified = await visitor(db, ago(9), "user");
      // A lead: a teammate saved a contact email (directory/people.ts). No foreign key holds it.
      const lead = await visitor(db, ago(9));
      await db
        .update(principal)
        .set({ contactEmail: "lead@example.test" })
        .where(eq(principal.id, lead.principalId));
      // Only the profile is referenced: the principal goes, the profile stays.
      const profile = await visitor(db, ago(9));
      await db
        .insert(auditLog)
        .values({ eventType: "user.updated", actorUserId: profile.customerId });
      return {
        ended,
        subscribed,
        audited,
        session,
        recent,
        identified,
        lead,
        profile,
      };
    };
    const people = await both(seed);
    await prune();
    const a = await present(h.a);
    expect(a.principals).not.toContain(people.a.ended.principalId);
    expect(a.customers).not.toContain(people.a.ended.customerId);
    expect(a.principals).not.toContain(people.a.profile.principalId);
    expect(a.customers).toContain(people.a.profile.customerId);
    for (const kept of [
      "subscribed",
      "audited",
      "session",
      "recent",
      "identified",
      "lead",
    ] as const) {
      expect(a.principals, kept).toContain(people.a[kept].principalId);
      expect(a.customers, kept).toContain(people.a[kept].customerId);
    }
    expect(
      await h.system(h.a, (db) =>
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(statusSubscriptions)
          .where(
            eq(
              statusSubscriptions.principalId,
              people.a.subscribed.principalId,
            ),
          ),
      ),
    ).toEqual([{ n: 1 }]);
    const b = await present(h.b);
    for (const kept of Object.values(people.b)) {
      expect(b.principals).toContain(kept.principalId);
      expect(b.customers).toContain(kept.customerId);
    }
  });

  it("moves past a full batch of visitors that stay, so later ones still go", async () => {
    const later = await h.system(h.a, async (db) => {
      const identities = await db
        .insert(customer)
        .values(
          Array.from({ length: 1001 }, () => ({
            name: "Anonymous",
            isAnonymous: true,
          })),
        )
        .returning({ id: customer.id });
      const kept = await db
        .insert(principal)
        .values(
          identities.map(({ id }) => ({
            userId: id,
            role: "user",
            type: "anonymous",
            createdAt: ago(20),
          })),
        )
        .returning({ id: principal.id });
      await db
        .insert(statusSubscriptions)
        .values(
          kept.map(({ id }) => ({ principalId: id, source: "auto" as const })),
        );
      return visitor(db, ago(10));
    });
    // The oldest 1,000 all stay, so the first run removes nothing and moves its cursor.
    await prune();
    expect((await present(h.a)).principals).toContain(later.principalId);
    await prune();
    expect((await present(h.a)).principals).not.toContain(later.principalId);
  });
});
