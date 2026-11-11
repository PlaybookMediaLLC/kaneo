import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auditLog } from "../../../database/quills/schema/audit-log";
import {
  principal,
  settings,
  user,
} from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import {
  channelAccounts,
  emailSendingDomains,
} from "../../../database/quills/schema/channel-accounts";
import { customDomains } from "../../../database/quills/schema/custom-domains";
import { events } from "../../../database/quills/schema/events";
import { files } from "../../../database/quills/schema/files";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { teams } from "../../../database/quills/schema/teams";
import * as kaneo from "../../../database/schema";
import { fanOut } from "../fanout";
import { claimQuillsJob } from "../queue";
import { harness } from "./harness.fixture";
import { runWipeJob, WIPED_TABLES } from "./wipe";

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
const h = harness("wipe");
const kaneoTeam = `${h.a}_team`;

/** Feedback, customers, a file, a Kaneo-bound team, a sending address and a custom domain in one workspace. */
async function seed(workspaceId: string, userId: string, tag: string) {
  return h.as(workspaceId, userId, async (db, actor) => {
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(eq(postStatuses.isDefault, true));
    const [board] = await db
      .insert(boards)
      .values({ name: "Board", slug: `${tag}-board` })
      .returning({ id: boards.id });
    const [profile] = await db
      .insert(user)
      .values({ name: "Customer", imageKey: `${tag}/avatar.png` })
      .returning({ id: user.id });
    const [customer] = await db
      .insert(principal)
      .values({
        userId: profile!.id,
        role: "user",
        displayName: "Customer",
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    const [post] = await db
      .insert(posts)
      .values({
        title: "Post",
        content: "Post",
        boardId: board!.id,
        principalId: customer!.id,
        statusId: status!.id,
      })
      .returning({ id: posts.id });
    await db.insert(postComments).values({
      postId: post!.id,
      principalId: actor.principalId,
      content: "Reply",
      isTeamMember: true,
    });
    await db.insert(files).values({
      storageKey: `${tag}/file.png`,
      name: "file.png",
      contentType: "image/png",
      size: 5,
      sha256: "0".repeat(64),
      family: "image",
      source: "upload",
    });
    const [team] = await db
      .insert(teams)
      .values({ name: `Support ${tag}` })
      .returning({ id: teams.id });
    const [sending] = await db
      .insert(emailSendingDomains)
      .values({ owningTeamId: team!.id, domain: `${tag}.example.com` })
      .returning({ id: emailSendingDomains.id });
    await db.insert(channelAccounts).values({
      owningTeamId: team!.id,
      role: "sending",
      address: `help@${tag}.example.com`,
      sendingDomainId: sending!.id,
    });
    // A wipe keeps custom domains, so a second seed finds this one.
    await db
      .insert(customDomains)
      .values({
        kind: "portal",
        domain: `${tag}-portal.example.com`,
        verificationValue: "x",
      })
      .onConflictDoNothing();
    return actor.principalId;
  });
}

/** A hash of every row of the workspace in the listed tables, or in all Quills tables. */
async function fingerprint(workspaceId: string, only?: string[]) {
  const tables: string[] = (
    await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_attribute t ON t.attrelid=c.oid AND t.attname='workspace_id' AND NOT t.attisdropped
       WHERE n.nspname='quills' AND c.relkind IN ('r','p') AND NOT c.relispartition ORDER BY 1`,
    )
  ).rows
    .map((row) => row.relname)
    .filter((table: string) => !only || only.includes(table));
  const { rows } = await pool.query(
    `SELECT ${tables
      .map(
        (table) =>
          `(SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM quills."${table}" x WHERE x.workspace_id=$1)`,
      )
      .join(" || ")} AS h`,
    [workspaceId],
  );
  return rows[0].h as string;
}

const rowsIn = async (workspaceId: string, table: string) =>
  Number(
    (
      await pool.query(
        `SELECT count(*) FROM quills."${table}" WHERE workspace_id=$1${table === "principal" ? " AND kaneo_user_id IS NULL" : ""}`,
        [workspaceId],
      )
    ).rows[0].count,
  );
/** The wiped tables that still hold rows of the workspace, in one query. */
const leftovers = async (workspaceId: string) =>
  (
    await pool.query(
      WIPED_TABLES.map(
        (table) =>
          `SELECT '${table}' AS name, count(*)::int AS n FROM quills."${table}" WHERE workspace_id=$1${table === "principal" ? " AND kaneo_user_id IS NULL" : ""}`,
      ).join(" UNION ALL "),
      [workspaceId],
    )
  ).rows.filter((row) => row.n > 0);
const wipeJobs = () =>
  h.system(h.a, (db) =>
    db.select().from(jobQueue).where(eq(jobQueue.queue, "quills.wipe")),
  );
const requestWipe = (actorId: string) =>
  h.emit(h.a, {
    type: "workspace.wipe_requested",
    entityType: "workspace",
    entityId: h.a,
    actorId,
  });

describe.skipIf(!url)("Quills workspace wipe job", () => {
  let owner: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    // A Kaneo team bound to a Quills team projects its roster, which the runtime role cannot delete directly.
    await h.db().insert(kaneo.teamTable).values({
      id: kaneoTeam,
      workspaceId: h.a,
      name: "Shared",
      createdAt: new Date(),
    });
    await h
      .db()
      .insert(kaneo.teamMemberTable)
      .values({ id: `${kaneoTeam}_m`, teamId: kaneoTeam, userId: h.mate });
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  async function seedBoth() {
    owner = await seed(
      h.a,
      h.owner,
      `${h.a}-${Date.now()}`.replaceAll("_", "-"),
    );
    await seed(h.b, h.outsider, `${h.b}-${Date.now()}`.replaceAll("_", "-"));
    await h.as(h.a, h.owner, (db) =>
      db.insert(teams).values({ name: "Shared", kaneoTeamId: kaneoTeam }),
    );
    expect(await rowsIn(h.a, "team_members")).toBeGreaterThan(0);
  }

  it("rolls a failed wipe back completely, then wipes on the retry and leaves workspace B alone", async () => {
    await seedBoth();
    const b = await fingerprint(h.b);
    const kept = ["settings", "post_statuses", "roles", "custom_domains"];
    const keptBefore = await fingerprint(h.a, kept);
    const auditBefore = await rowsIn(h.a, "audit_log");
    const dataBefore = await fingerprint(h.a, WIPED_TABLES);

    // Fail late in the wipe: customer actors go after everything that references them.
    // The function lives outside the quills schema; the trigger exists only for this drain.
    await pool.query(
      `CREATE FUNCTION public.quills_test_wipe_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
       IF OLD.workspace_id = '${h.a}' THEN RAISE EXCEPTION 'Injected wipe failure'; END IF; RETURN OLD; END $$`,
    );
    try {
      await pool.query(
        "CREATE TRIGGER quills_test_wipe_failure BEFORE DELETE ON quills.principal FOR EACH ROW EXECUTE FUNCTION public.quills_test_wipe_failure()",
      );
      await requestWipe(owner);
      await h.drain(h.a);
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS quills_test_wipe_failure ON quills.principal",
      );
      await pool.query("DROP FUNCTION public.quills_test_wipe_failure()");
    }
    const [failed] = await wipeJobs();
    expect(failed).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "quills.wipe failed",
    });
    expect(await fingerprint(h.a, WIPED_TABLES)).toBe(dataBefore);
    expect(await rowsIn(h.a, "posts")).toBe(1);

    await h.due(h.a);
    // The waiting wipe job alone makes the workspace runnable for the scheduler.
    expect(
      await h.system(h.a, (db) =>
        db
          .select({ id: jobQueue.id })
          .from(jobQueue)
          .where(
            sql`${jobQueue.status} <> 'succeeded' AND ${jobQueue.queue} <> 'quills.wipe'`,
          ),
      ),
    ).toEqual([]);
    const runnable = await pool.query(
      "SELECT quills.runnable_workspaces('') AS id",
    );
    expect(runnable.rows.map((row) => row.id)).toContain(h.a);
    await h.drain(h.a);
    expect((await wipeJobs())[0]).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });

    expect(await leftovers(h.a)).toEqual([]);
    // Deleting the teams removed the bound roster.
    expect(await rowsIn(h.a, "team_members")).toBe(0);
    // Teammate actors, settings, catalogues and custom domains stay; audit history only grows.
    expect(
      await h.system(h.a, (db) =>
        db
          .select({ id: principal.id })
          .from(principal)
          .where(eq(principal.id, owner as never)),
      ),
    ).toHaveLength(1);
    expect(await fingerprint(h.a, kept)).toBe(keptBefore);
    expect(await rowsIn(h.a, "audit_log")).toBe(auditBefore + 1);
    const [done] = await h.system(h.a, (db) =>
      db
        .select({ actorType: auditLog.actorType, targetId: auditLog.targetId })
        .from(auditLog)
        .where(eq(auditLog.eventType, "workspace.wiped")),
    );
    expect(done).toEqual({ actorType: "system", targetId: h.a });
    // The completion event invalidates client caches like any change.
    expect(
      await h.system(h.a, (db) =>
        db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.type, "workspace.wiped")),
      ),
    ).toHaveLength(1);

    // Removed object keys went to the shared cleanup queue; B's did not.
    const queued = (
      await pool.query("SELECT object_key FROM public.storage_cleanup")
    ).rows.map((row) => row.object_key as string);
    expect(
      queued.filter((key) => key.startsWith(h.a.replaceAll("_", "-"))),
    ).toHaveLength(2);
    expect(queued.some((key) => key.startsWith(h.b.replaceAll("_", "-")))).toBe(
      false,
    );

    expect(await fingerprint(h.b)).toBe(b);
  });

  it("deduplicates the job, survives a rerun and refuses a job that is not a wipe request", async () => {
    await seedBoth();
    await h.system(h.a, (db) =>
      db.delete(jobQueue).where(eq(jobQueue.queue, "quills.wipe")),
    );
    const eventId = await requestWipe(owner);
    await fanOut(h.a, eventId);
    await fanOut(h.a, eventId);
    expect(await wipeJobs()).toHaveLength(1);

    // A lost lease rolls the wipe back.
    const job = await h.system(h.a, async (db) => {
      await db
        .update(jobQueue)
        .set({ runAt: sql`now() + interval '1 hour'` })
        .where(
          and(
            eq(jobQueue.status, "pending"),
            sql`${jobQueue.queue} <> 'quills.wipe'`,
          ),
        );
      return claimQuillsJob(db);
    });
    expect(job?.queue).toBe("quills.wipe");
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({ lockedUntil: sql`now() - interval '1 second'` })
        .where(eq(jobQueue.id, job!.id)),
    );
    await expect(runWipeJob(h.a, job!)).rejects.toThrow(
      "Quills job lease lost",
    );
    expect(await rowsIn(h.a, "posts")).toBe(1);

    // The replacement worker wipes; running the same job again deletes nothing more.
    await h.due(h.a);
    await h.drain(h.a);
    expect(await rowsIn(h.a, "posts")).toBe(0);
    const [done] = await wipeJobs();
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({ status: "pending", runAt: new Date(0) })
        .where(eq(jobQueue.id, done!.id)),
    );
    expect((await h.drain(h.a)).failed).toBe(0);

    // A stray job whose event is not a wipe request deletes nothing.
    await seedBoth();
    const other = await h.emit(h.a, {
      type: "post.created",
      entityType: "workspace",
      entityId: h.a,
    });
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({
          status: "pending",
          runAt: new Date(0),
          dedupeKey: other,
          payload: { eventId: other },
        })
        .where(eq(jobQueue.id, done!.id)),
    );
    await h.drain(h.a);
    expect(await rowsIn(h.a, "posts")).toBe(1);
    expect(
      await h.system(h.a, (db) =>
        db.select({ name: settings.name }).from(settings),
      ),
    ).toHaveLength(1);
  });
});
