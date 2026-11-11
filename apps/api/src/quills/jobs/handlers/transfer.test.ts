import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { principal, user } from "../../../database/quills/schema/auth";
import { boards, postTags } from "../../../database/quills/schema/boards";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { exportRuns } from "../../../database/quills/schema/export-runs";
import { postExternalLinks } from "../../../database/quills/schema/external-links";
import { files } from "../../../database/quills/schema/files";
import { importRuns } from "../../../database/quills/schema/import-runs";
import { boardProjects } from "../../../database/quills/schema/platform-links";
import {
  posts,
  postTagAssignments,
  postVotes,
} from "../../../database/quills/schema/posts";
import type { Database } from "../../../database/quills/client";
import * as kaneo from "../../../database/schema";
import { startFeature } from "../../feedback/harness.fixture";
import { createUpload } from "../../framework/files";
import { drainQuillsWorkspace } from "../worker";

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
vi.mock("../../../storage/s3", async (original) => ({
  ...(await original<typeof import("../../../storage/s3")>()),
  verifyTaskAssetUpload: vi.fn(
    async (_key: string, expected: { size: number; contentType: string }) =>
      expected,
  ),
}));
// An in-memory bucket: uploads land here and reads come from here.
const bucket = new Map<string, string>();
let failPut = false;
/** Runs while an upload is in flight, before it lands. */
let duringPut: ((key: string) => Promise<void>) | undefined;
vi.spyOn(S3Client.prototype, "send").mockImplementation((async (
  command: unknown,
) => {
  if (command instanceof PutObjectCommand) {
    if (failPut) throw new Error("storage is down");
    await duringPut?.(command.input.Key!);
    bucket.set(command.input.Key!, String(command.input.Body));
    return {};
  }
  if (command instanceof GetObjectCommand) {
    const body = bucket.get(command.input.Key!);
    if (body === undefined) throw new Error("NoSuchKey");
    return { Body: Readable.from([Buffer.from(body)]) };
  }
  throw new Error("Unexpected storage call");
}) as never);

const url = process.env.QUILLS_TEST_DATABASE_URL;
let world: Awaited<ReturnType<typeof startFeature>>;
let ids: {
  open: TypeId<"board">;
  hidden: TypeId<"board">;
  plainSlug: string;
  hiddenSlug: string;
  member: TypeId<"principal">;
};

const drain = () => drainQuillsWorkspace(world.a, async () => {});
const cleanupQueued = async (key: string) =>
  (
    await pool.query(
      "SELECT 1 FROM public.storage_cleanup WHERE object_key = $1",
      [key],
    )
  ).rows.length === 1;
const inA = <T>(work: (db: Database) => Promise<T>) =>
  world.scoped(world.a, world.users.owner, work);

/** Uploads a CSV as a browser would, then starts an import run as the member. */
async function startImport(csv: string, boardId: string = ids.open) {
  const size = Buffer.byteLength(csv);
  const { key } = await createUpload(world.a, {
    purpose: "file",
    filename: "posts.csv",
    contentType: "text/csv",
    size,
  });
  bucket.set(key, csv);
  const res = await world.request(
    world.users.member,
    "POST",
    "/transfer/import-runs",
    { key, contentType: "text/csv", size, name: "posts.csv", boardId },
  );
  expect(res.status).toBe(200);
  return { key, runId: res.body.runId as string };
}
const importRun = async (runId: string) =>
  (
    await world.request(
      world.users.member,
      "GET",
      `/transfer/import-runs/${runId}`,
    )
  ).body;
/** Starts an export as the member, runs the worker and returns the run and its file. */
async function exportFile(kind: string) {
  const created = await world.request(
    world.users.member,
    "POST",
    "/transfer/export-runs",
    { kind },
  );
  expect(created.status).toBe(200);
  await drain();
  const [run] = await inA((db) =>
    db
      .select({ status: exportRuns.status, key: exportRuns.s3Key })
      .from(exportRuns)
      .where(eq(exportRuns.id, created.body.runId)),
  );
  expect(run!.status).toBe("completed");
  return bucket.get(run!.key!)!;
}
const titled = (titles: string[]) =>
  inA((db) =>
    db
      .select({ title: posts.title, principalId: posts.principalId })
      .from(posts)
      .where(inArray(posts.title, titles)),
  );

describe.skipIf(!url)("Transfer run jobs", () => {
  beforeAll(async () => {
    vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9");
    vi.stubEnv("S3_BUCKET", "quills-transfer");
    vi.stubEnv("S3_ACCESS_KEY_ID", "transfer");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "transfer-secret");
    vi.stubEnv("S3_KEY_PREFIX", "");
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "transfer");
    const { a, users, projects } = world;
    ids = await world.scoped(a, users.owner, async (db, actor) => {
      const board = async (slug: string) =>
        (
          await db
            .insert(boards)
            .values({ name: slug, slug })
            .returning({ id: boards.id })
        )[0]!.id;
      const stamp = Date.now();
      const hidden = await board(`hidden-${stamp}`);
      const open = await board(`open-${stamp}`);
      const plain = await board(`plain-${stamp}`);
      await db.insert(boardProjects).values([
        { boardId: hidden, projectId: projects.hidden },
        { boardId: open, projectId: projects.open },
      ]);
      const customer = async (name: string, test: boolean) => {
        const [profile] = await db
          .insert(user)
          .values({ name, email: `${name.toLowerCase()}@example.test` })
          .returning({ id: user.id });
        const [row] = await db
          .insert(principal)
          .values({
            userId: profile!.id,
            type: "user",
            role: "user",
            displayName: name,
            createdAt: new Date(),
            testOwnerPrincipalId: test ? actor.principalId : null,
          })
          .returning({ id: principal.id });
        return row!.id;
      };
      const tester = { id: await customer("Tester", true) };
      const known = await customer("Known", false);
      const post = async (
        boardId: TypeId<"board">,
        title: string,
        extra = {},
      ) =>
        (
          await db
            .insert(posts)
            .values({
              title,
              content: title,
              boardId,
              principalId: actor.principalId,
              ...extra,
            })
            .returning({ id: posts.id })
        )[0]!.id;
      const hiddenPost = await post(hidden, "Hidden export idea");
      const openPost = await post(open, "Open export idea");
      // Known votes on a hidden and a visible post: the member's users export counts one vote.
      await db.insert(postVotes).values([
        { postId: hiddenPost, principalId: known },
        { postId: openPost, principalId: known },
      ]);
      for (const [visitor, text] of [
        [known, "Real conversation message"],
        [tester.id, "Test conversation message"],
      ] as const) {
        const [conversation] = await db
          .insert(conversations)
          .values({ visitorPrincipalId: visitor, channel: "messenger" })
          .returning({ id: conversations.id });
        await db.insert(conversationMessages).values({
          conversationId: conversation!.id,
          principalId: visitor,
          senderType: "visitor",
          content: text,
        });
      }
      await post(plain, "Plain export idea");
      await post(plain, "Tester export idea", { principalId: tester!.id });
      await post(plain, "Deleted export idea", { deletedAt: new Date() });
      await db.insert(postTags).values({ name: "Alpha" });
      return {
        open,
        hidden,
        plainSlug: `plain-${stamp}`,
        hiddenSlug: `hidden-${stamp}`,
        member: undefined as unknown as TypeId<"principal">,
      };
    });
    ids.member = await world.scoped(
      a,
      users.member,
      async (_db, actor) => actor.principalId,
    );
  }, 120000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await world?.stop();
  });

  it("exports only the posts the initiator can see and signs a short-lived download", async () => {
    const created = await world.request(
      world.users.member,
      "POST",
      "/transfer/export-runs",
      { kind: "posts" },
    );
    expect(created.status).toBe(200);
    const { runId } = created.body;
    // One active export per workspace.
    const second = await world.request(
      world.users.owner,
      "POST",
      "/transfer/export-runs",
      { kind: "users" },
    );
    expect(second.status).toBe(409);
    await drain();

    const run = await world.request(
      world.users.member,
      "GET",
      `/transfer/export-runs/${runId}`,
    );
    expect(run.body).toMatchObject({
      status: "completed",
      entityCounts: { posts: 2 },
    });
    const [stored] = await inA((db) =>
      db
        .select({ key: exportRuns.s3Key })
        .from(exportRuns)
        .where(eq(exportRuns.id, runId)),
    );
    const csv = bucket.get(stored!.key!)!;
    expect(csv).toContain("Open export idea");
    expect(csv).toContain("Plain export idea");
    expect(csv).not.toContain("Hidden export idea");
    expect(csv).not.toContain("Tester export idea");
    expect(csv).not.toContain("Deleted export idea");
    expect(stored!.key!.startsWith(`workspace/${world.a}/quills/export/`)).toBe(
      true,
    );

    const download = await world.request(
      world.users.member,
      "GET",
      `/transfer/export-runs/${runId}/download`,
    );
    expect(download.status).toBe(200);
    expect(download.body.downloadUrl).toContain("X-Amz-Expires=");
    expect(new Date(download.body.downloadExpiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    // Another teammate cannot read or download this run, not even an owner.
    for (const path of [
      `/transfer/export-runs/${runId}`,
      `/transfer/export-runs/${runId}/download`,
    ])
      expect((await world.request(world.users.owner, "GET", path)).status).toBe(
        404,
      );
    const listed = await world.request(
      world.users.owner,
      "GET",
      "/transfer/export-runs",
    );
    expect(JSON.stringify(listed.body)).not.toContain(runId);
    // An expired run gives no URL.
    await inA((db) =>
      db
        .update(exportRuns)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(exportRuns.id, runId)),
    );
    expect(
      (
        await world.request(
          world.users.member,
          "GET",
          `/transfer/export-runs/${runId}/download`,
        )
      ).status,
    ).toBe(409);
  });

  it("fails a run whose attempt stopped and queues its partial file for cleanup", async () => {
    const created = await world.request(
      world.users.member,
      "POST",
      "/transfer/export-runs",
      { kind: "companies" },
    );
    const key = `workspace/${world.a}/quills/export/stopped.csv`;
    // As if an earlier attempt claimed the run and then crashed.
    await inA((db) =>
      db
        .update(exportRuns)
        .set({ status: "running", s3Key: key })
        .where(eq(exportRuns.id, created.body.runId)),
    );
    await drain();
    const run = await world.request(
      world.users.member,
      "GET",
      `/transfer/export-runs/${created.body.runId}`,
    );
    expect(run.body).toMatchObject({
      status: "failed",
      error: "The export stopped before it finished",
    });
    expect(await cleanupQueued(key)).toBe(true);
  });

  it("fails the run without a raw error and releases its key when storage fails", async () => {
    const exportKeys = async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM public.storage_cleanup WHERE object_key LIKE $1",
          [`workspace/${world.a}/quills/export/%`],
        )
      ).rows[0].n as number;
    const before = await exportKeys();
    failPut = true;
    try {
      const created = await world.request(
        world.users.member,
        "POST",
        "/transfer/export-runs",
        { kind: "users" },
      );
      await drain();
      const [row] = await inA((db) =>
        db
          .select({
            status: exportRuns.status,
            error: exportRuns.error,
            key: exportRuns.s3Key,
          })
          .from(exportRuns)
          .where(eq(exportRuns.id, created.body.runId)),
      );
      expect(row).toEqual({
        status: "failed",
        error: "The export failed",
        key: null,
      });
      // The key that the run reserved is queued; cleanup removes the object if it exists.
      expect(await exportKeys()).toBe(before + 1);
    } finally {
      failPut = false;
    }
  });

  it("releases its upload when another attempt settled the run during the upload", async () => {
    let uploaded = "";
    duringPut = async (key) => {
      uploaded = key;
      // Another attempt fails the run and clears the key, and cleanup runs before this upload lands.
      await pool.query(
        "UPDATE quills.export_runs SET status = 'failed', s3_key = NULL WHERE workspace_id = $1 AND status = 'running'",
        [world.a],
      );
      await pool.query(
        "DELETE FROM public.storage_cleanup WHERE object_key = $1",
        [key],
      );
    };
    try {
      await world.request(world.users.member, "POST", "/transfer/export-runs", {
        kind: "posts",
      });
      await drain();
    } finally {
      duringPut = undefined;
    }
    expect(bucket.has(uploaded)).toBe(true);
    expect(await cleanupQueued(uploaded)).toBe(true);
  });

  it("exports customers with activity counts limited to visible posts, and no test customers", async () => {
    const csv = await exportFile("users");
    const known = csv.split("\r\n").find((line) => line.startsWith("Known,"));
    // name, email, verified, joined_at, post_count, comment_count, vote_count
    expect(known?.split(",")).toEqual([
      "Known",
      "known@example.test",
      "false",
      expect.any(String),
      "0",
      "0",
      "1",
    ]);
    expect(csv).not.toContain("Tester");
    expect(csv).not.toContain(world.users.owner);
    expect(csv).not.toContain(world.users.member);
  });

  it("exports companies and conversations without test customers", async () => {
    expect(await exportFile("companies")).toMatch(/^name,domain,external_id/);
    const conversationsCsv = await exportFile("conversations");
    expect(conversationsCsv).toContain("Real conversation message");
    expect(conversationsCsv).not.toContain("Test conversation message");
  });

  it("frees the export slot from a run that no live job will settle", async () => {
    const created = await world.request(
      world.users.member,
      "POST",
      "/transfer/export-runs",
      { kind: "posts" },
    );
    const key = `workspace/${world.a}/quills/export/abandoned.csv`;
    // As if the run's job ran out of attempts while the run was running.
    await inA((db) =>
      db
        .update(exportRuns)
        .set({ status: "running", s3Key: key })
        .where(eq(exportRuns.id, created.body.runId)),
    );
    await pool.query(
      "UPDATE quills.job_queue SET status = 'failed' WHERE workspace_id = $1 AND status IN ('pending', 'running')",
      [world.a],
    );
    const next = await world.request(
      world.users.member,
      "POST",
      "/transfer/export-runs",
      { kind: "posts" },
    );
    expect(next.status).toBe(200);
    const old = await world.request(
      world.users.member,
      "GET",
      `/transfer/export-runs/${created.body.runId}`,
    );
    expect(old.body).toMatchObject({
      status: "failed",
      error: "The export stopped before it finished",
    });
    expect(await cleanupQueued(key)).toBe(true);
    await drain();
  });

  it("refuses a CSV of the wrong type or size and a board the caller cannot see", async () => {
    const send = (body: Record<string, unknown>) =>
      world.request(world.users.member, "POST", "/transfer/import-runs", {
        key: `workspace/${world.a}/quills/file/x.csv`,
        contentType: "text/csv",
        size: 10,
        name: "posts.csv",
        boardId: ids.open,
        ...body,
      });
    expect((await send({ contentType: "application/pdf" })).status).toBe(400);
    expect((await send({ size: 11 * 1024 * 1024 })).status).toBe(400);
    const csv = "title,content\nHidden target,Body\n";
    const { key } = await createUpload(world.a, {
      purpose: "file",
      filename: "posts.csv",
      contentType: "text/csv",
      size: csv.length,
    });
    bucket.set(key, csv);
    expect(
      (await send({ key, size: csv.length, boardId: ids.hidden })).status,
    ).toBe(404);
  });

  it("fails the run when its board becomes hidden before the job", async () => {
    const boardId = await inA(async (db) => {
      const [board] = await db
        .insert(boards)
        .values({ name: "Later hidden", slug: `later-${Date.now()}` })
        .returning({ id: boards.id });
      return board!.id;
    });
    const { runId } = await startImport(
      "title,content\nLate row,Body\n",
      boardId,
    );
    await inA((db) =>
      db
        .insert(boardProjects)
        .values({ boardId, projectId: world.projects.hidden }),
    );
    await drain();
    expect(await importRun(runId)).toMatchObject({
      status: "failed",
      errorReport: [
        {
          row: 0,
          field: "boardId",
          message: "The target board is not available",
        },
      ],
    });
    expect(await titled(["Late row"])).toEqual([]);
  });

  it("reports every invalid field and refuses teammate and test-customer authors", async () => {
    const { runId } = await startImport(
      [
        "title,content,status,created_at,author_email,source_id",
        "One,Body,No such status,,,dup",
        "Two,Body,,2999-01-01T00:00:00Z,,dup",
        "Three,Body,,1,not-an-email,",
      ].join("\n"),
    );
    await drain();
    const run = await importRun(runId);
    expect(run.status).toBe("failed");
    expect(
      run.errorReport.map((e: { row: number; field: string }) => [
        e.row,
        e.field,
      ]),
    ).toEqual([
      [1, "status"],
      [2, "created_at"],
      [2, "source_id"],
      [3, "author_email"],
      [3, "created_at"],
    ]);

    const authors = await startImport(
      [
        "title,content,author_email",
        "By tester,Body,tester@example.test",
        `By owner,Body,${world.users.owner}@example.test`,
      ].join("\n"),
    );
    await drain();
    expect(await importRun(authors.runId)).toMatchObject({
      status: "failed",
      errorReport: [
        { row: 1, field: "author_email" },
        { row: 2, field: "author_email" },
      ],
    });
    expect(await titled(["By tester", "By owner"])).toEqual([]);
  });

  it("fails the run when its initiator left the workspace before the job", async () => {
    const { runId } = await startImport("title,content\nOrphan row,Body\n");
    const [membership] = await world.db
      .delete(kaneo.workspaceUserTable)
      .where(
        and(
          eq(kaneo.workspaceUserTable.workspaceId, world.a),
          eq(kaneo.workspaceUserTable.userId, world.users.member),
        ),
      )
      .returning();
    try {
      await drain();
    } finally {
      await world.db.insert(kaneo.workspaceUserTable).values(membership!);
    }
    expect(await importRun(runId)).toMatchObject({
      status: "failed",
      errorReport: [
        {
          row: 0,
          message:
            "The teammate who started this import can no longer read Quills",
        },
      ],
    });
    expect(await titled(["Orphan row"])).toEqual([]);
  });

  it("writes nothing when one row is invalid, and reports the row", async () => {
    const { key, runId } = await startImport(
      "title,content,tags\nGood row,Body,Alpha\nBad row,Body,Missing\n",
    );
    await drain();
    const run = await importRun(runId);
    expect(run).toMatchObject({
      status: "failed",
      totals: { rows: 2, created: 0, errors: 1 },
      errorReport: [{ row: 2, field: "tags", message: "Unknown tag: Missing" }],
    });
    expect(await titled(["Good row", "Bad row"])).toEqual([]);
    // The uploaded CSV is released for cleanup.
    expect(
      await inA((db) =>
        db.select().from(files).where(eq(files.storageKey, key)),
      ),
    ).toEqual([]);
    expect(await cleanupQueued(key)).toBe(true);
  });

  it("refuses a row for a board the initiator cannot see", async () => {
    const { runId } = await startImport(
      `title,content,board\nVisible row,Body,${ids.plainSlug}\nSneaky row,Body,${ids.hiddenSlug}\n`,
    );
    await drain();
    expect(await importRun(runId)).toMatchObject({
      status: "failed",
      errorReport: [{ row: 2, field: "board" }],
    });
    expect(await titled(["Visible row", "Sneaky row"])).toEqual([]);
  });

  it("imports every valid row with its author, tags and source link; a rerun skips imported rows", async () => {
    const csv = [
      "Title,Content,Tags,Author Email,Author Name,Source ID,Created At",
      "Imported one,First,Alpha,new@example.test,New Person,src-1,2026-01-02T00:00:00Z",
      "Imported two,Second,,known@example.test,,,",
      "Imported three,Third,,,,,",
    ].join("\n");
    const first = await startImport(csv);
    await drain();
    expect(await importRun(first.runId)).toMatchObject({
      status: "completed",
      totals: { rows: 3, created: 3, skipped: 0, errors: 0 },
      errorReport: null,
    });
    const rows = await titled([
      "Imported one",
      "Imported two",
      "Imported three",
    ]);
    expect(rows).toHaveLength(3);
    const authors = await inA((db) =>
      db
        .select({ email: user.email, id: principal.id })
        .from(principal)
        .innerJoin(user, eq(user.id, principal.userId))
        .where(inArray(user.email, ["new@example.test", "known@example.test"])),
    );
    const author = (email: string) =>
      authors.find((a) => a.email === email)!.id;
    const by = (title: string) =>
      rows.find((r) => r.title === title)!.principalId;
    expect(by("Imported one")).toBe(author("new@example.test"));
    expect(by("Imported two")).toBe(author("known@example.test"));
    expect(by("Imported three")).toBe(ids.member);
    const linked = await inA((db) =>
      db
        .select({ title: posts.title, createdAt: posts.createdAt })
        .from(postExternalLinks)
        .innerJoin(posts, eq(posts.id, postExternalLinks.postId))
        .innerJoin(postTagAssignments, eq(postTagAssignments.postId, posts.id))
        .where(
          and(
            eq(postExternalLinks.integrationType, "import"),
            eq(postExternalLinks.externalId, "src-1"),
          ),
        ),
    );
    expect(linked).toEqual([
      { title: "Imported one", createdAt: new Date("2026-01-02T00:00:00Z") },
    ]);

    const second = await startImport(csv);
    await drain();
    expect(await importRun(second.runId)).toMatchObject({
      status: "completed",
      totals: { rows: 3, created: 2, skipped: 1 },
    });
    expect(await titled(["Imported one"])).toHaveLength(1);
  });

  it("imports a source_id once when two runs settle at the same time", async () => {
    const csv = "title,content,source_id\nTwice submitted,Body,src-twice\n";
    const first = await startImport(csv);
    const second = await startImport(csv);
    // Two workers drain the workspace at once; each claims one run's job.
    await Promise.all([drain(), drain()]);
    await drain();
    const runs = [await importRun(first.runId), await importRun(second.runId)];
    expect(runs.map((r) => r.status)).toEqual(["completed", "completed"]);
    expect(runs.map((r) => r.totals.created).sort()).toEqual([0, 1]);
    expect(await titled(["Twice submitted"])).toHaveLength(1);
  });

  it("rolls every inserted post back when a later write fails", async () => {
    await pool.query(`CREATE FUNCTION quills.p9_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
    await pool.query(
      "CREATE TRIGGER p9_fail BEFORE INSERT ON quills.post_external_links FOR EACH ROW EXECUTE FUNCTION quills.p9_fail()",
    );
    let runId: string;
    let key: string;
    try {
      ({ runId, key } = await startImport(
        "title,content,source_id\nRolled back,Body,src-rollback\n",
      ));
      await drain();
    } finally {
      await pool.query("DROP TRIGGER p9_fail ON quills.post_external_links");
      await pool.query("DROP FUNCTION quills.p9_fail()");
    }
    // The posts were written before the failing link insert, and none remain.
    expect(await titled(["Rolled back"])).toEqual([]);
    const [stuck] = await inA((db) =>
      db
        .select({ status: importRuns.status })
        .from(importRuns)
        .where(eq(importRuns.id, runId as TypeId<"import_run">)),
    );
    expect(stuck!.status).toBe("running");
    // The retry finds the stopped attempt and fails the run instead of importing twice.
    await pool.query(
      "UPDATE quills.job_queue SET run_at = now() - interval '1 second' WHERE workspace_id = $1 AND status = 'pending'",
      [world.a],
    );
    // Only the quills.transfer job waits now: the worker finds the workspace through migration 0013.
    const waiting = await pool.query(
      "SELECT queue FROM quills.job_queue WHERE workspace_id = $1 AND status = 'pending'",
      [world.a],
    );
    expect(waiting.rows.map((r) => r.queue)).toEqual(["quills.transfer"]);
    const runnable = await pool.query(
      "SELECT quills.runnable_workspaces('') AS id",
    );
    expect(runnable.rows.map((r) => r.id)).toContain(world.a);
    await drain();
    expect(await importRun(runId)).toMatchObject({
      status: "failed",
      errorReport: [
        { row: 0, message: "The import stopped before it finished" },
      ],
    });
    expect(await titled(["Rolled back"])).toEqual([]);
    expect(await cleanupQueued(key!)).toBe(true);
  });
});
