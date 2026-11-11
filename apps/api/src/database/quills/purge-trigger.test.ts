import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { toUuid } from "@kaneo/ids";
import * as kaneo from "../schema";
import { harness } from "../../quills/jobs/handlers/harness.fixture";
import { boards } from "./schema/boards";
import { postComments, posts } from "./schema/posts";
import { postStatuses } from "./schema/statuses";

// The purge trigger (migration 0021): workspace-scoped, and a customer delete reads only that
// customer's sync operations, also under the generic plan that a long-lived session reaches.

let pool: Pool;
vi.mock("../index", () => ({
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
const h = harness("purge");

/** `count` queued sync operations of `sourceType` in a workspace, each with a payload. */
const operations = (
  workspaceId: string,
  sourceType: string,
  count: number,
  recordId: string | null = null,
) =>
  pool.query(
    `INSERT INTO quills.integration_sync_operations (workspace_id, operation_key, integration_id,
       installation, provider, direction, kind, source_type, source_id, source_record_id, destination,
       destination_key, payload)
     SELECT $1, $2 || '-' || g, 'integration', 'installation', 'github', 'outbound', 'create', $3,
       'source-' || g, coalesce($5::uuid, gen_random_uuid()), '{}'::jsonb, 'destination-' || g, 'sealed'
     FROM generate_series(1, $4::int) g`,
    [workspaceId, randomUUID(), sourceType, count, recordId],
  );
const customer = async (workspaceId: string) =>
  (
    await pool.query(
      "INSERT INTO quills.customer_identity (workspace_id, id, name) VALUES ($1, gen_random_uuid(), 'Customer') RETURNING id",
      [workspaceId],
    )
  ).rows[0].id as string;

/**
 * Deletes the customer as the runtime role under generic plans, and returns how many
 * integration_sync_operations rows that delete read (sequential reads and index fetches).
 */
async function deleteReading(workspaceId: string, customerId: string) {
  const client = await pool.connect();
  const read = async () => {
    await client.query("SELECT pg_stat_clear_snapshot()");
    const { rows } = await client.query(
      "SELECT seq_tup_read + coalesce(idx_tup_fetch, 0) AS n FROM pg_stat_user_tables WHERE relid = 'quills.integration_sync_operations'::regclass",
    );
    return Number(rows[0].n);
  };
  try {
    await client.query("SELECT pg_stat_force_next_flush()");
    const before = await read();
    await client.query("BEGIN");
    await client.query("SELECT set_config('quills.workspace_id', $1, true)", [
      workspaceId,
    ]);
    await client.query("SET LOCAL ROLE quills_runtime");
    await client.query("SET LOCAL plan_cache_mode = force_generic_plan");
    await client.query("DELETE FROM quills.customer_identity WHERE id = $1", [
      customerId,
    ]);
    await client.query("COMMIT");
    await client.query("SELECT pg_stat_force_next_flush()");
    return (await read()) - before;
  } finally {
    client.release();
  }
}

describe.skipIf(!url)("Quills sync purge on a customer delete", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 3 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  it("purges the customer's operations in its workspace only and reads only those", async () => {
    // Comment operations in both workspaces: the old trigger read all of them for each delete.
    await operations(h.a, "comment", 10000);
    await operations(h.b, "comment", 10000);
    const person = await customer(h.a);
    await operations(h.a, "user", 1, person);
    // The same record ID in workspace B is another workspace's record.
    await operations(h.b, "user", 1, person);
    // Statistics, as autovacuum keeps them on a table this size: the planner then uses the indexes.
    await pool.query("ANALYZE quills.integration_sync_operations");

    const read = await deleteReading(h.a, person);
    expect(read).toBeLessThan(20);

    const { rows } = await pool.query(
      "SELECT workspace_id, state, payload, cancel_requested, error_code FROM quills.integration_sync_operations WHERE source_type = 'user' AND source_record_id = $1 ORDER BY workspace_id",
      [person],
    );
    expect(rows).toEqual([
      {
        workspace_id: h.a,
        state: "cancelled",
        payload: null,
        cancel_requested: true,
        error_code: "source_unavailable",
      },
      {
        workspace_id: h.b,
        state: "queued",
        payload: "sealed",
        cancel_requested: false,
        error_code: null,
      },
    ]);
  });

  it("purges the operations of a deleted post's comments and clears their attempt results", async () => {
    const { postId, commentId } = await h.as(
      h.a,
      h.owner,
      async (db, actor) => {
        const [status] = await db
          .select({ id: postStatuses.id })
          .from(postStatuses)
          .limit(1);
        const [board] = await db
          .insert(boards)
          .values({ name: "Purge", slug: `purge-${randomUUID()}` })
          .returning({ id: boards.id });
        const [post] = await db
          .insert(posts)
          .values({
            title: "Purge",
            content: "Purge",
            boardId: board!.id,
            principalId: actor.principalId,
            statusId: status!.id,
          })
          .returning({ id: posts.id });
        const [comment] = await db
          .insert(postComments)
          .values({
            postId: post!.id,
            principalId: actor.principalId,
            content: "Purge",
          })
          .returning({ id: postComments.id });
        return { postId: post!.id, commentId: comment!.id };
      },
    );
    const commentUuid = toUuid(commentId);
    await operations(h.a, "comment", 1, commentUuid);
    await pool.query(
      `INSERT INTO quills.integration_sync_attempts (workspace_id, operation_id, number, token, state, result)
       SELECT workspace_id, id, 1, gen_random_uuid(), 'failed', '{"remote":"kept"}'::jsonb
       FROM quills.integration_sync_operations WHERE workspace_id = $1 AND source_record_id = $2`,
      [h.a, commentUuid],
    );
    await h.as(h.a, h.owner, (db) =>
      db
        .update(posts)
        .set({ deletedAt: new Date() })
        .where(eq(posts.id, postId)),
    );
    const { rows } = await pool.query(
      `SELECT o.state, o.payload, a.result FROM quills.integration_sync_operations o
       JOIN quills.integration_sync_attempts a ON a.workspace_id = o.workspace_id AND a.operation_id = o.id
       WHERE o.workspace_id = $1 AND o.source_record_id = $2`,
      [h.a, commentUuid],
    );
    expect(rows).toEqual([{ state: "cancelled", payload: null, result: null }]);
  });
});
