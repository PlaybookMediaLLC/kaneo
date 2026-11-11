import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Pool } from "pg";
import { harness } from "../../quills/jobs/handlers/harness.fixture";

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("fkindex");
let pool: Pool;

/**
 * Foreign keys with no index that a delete of the parent row can use. An index counts when it
 * starts with the key's columns, or with a non-workspace key column; a partial one only when its
 * predicate is that column IS NOT NULL.
 */
const unindexed = `
WITH fk AS (
  SELECT c.conrelid, c.confrelid, c.conkey,
    array(SELECT k FROM unnest(c.conkey) k WHERE k <> (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='workspace_id')) AS selective
  FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
  WHERE c.contype='f' AND n.nspname='quills' AND c.conparentid=0
)
SELECT fk.conrelid::regclass::text || '.' || (SELECT attname FROM pg_attribute WHERE attrelid=fk.conrelid AND attnum=fk.selective[1]) AS key
FROM fk
WHERE NOT EXISTS (
  SELECT 1 FROM pg_index i WHERE i.indrelid=fk.conrelid AND i.indisvalid AND (
    ((i.indkey::int2[])[0:cardinality(fk.conkey)-1] @> fk.conkey AND (i.indkey::int2[])[0:cardinality(fk.conkey)-1] <@ fk.conkey)
    OR (cardinality(fk.selective) > 0 AND (i.indkey::int2[])[0] = ANY (fk.selective)))
  AND (i.indpred IS NULL OR pg_get_expr(i.indpred, i.indrelid) = '(' || (SELECT attname FROM pg_attribute WHERE attrelid=fk.conrelid AND attnum=fk.selective[1]) || ' IS NOT NULL)'))
ORDER BY 1`;

describe.skipIf(!url)("Quills foreign key indexes", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  it("indexes every foreign key except those to small configuration parents", async () => {
    const { rows } = await pool.query<{ key: string }>(unindexed);
    expect(rows.map((row) => row.key)).toEqual([
      "quills.changelog_entry_categories.changelog_entry_id",
      "quills.channel_accounts.owning_team_id",
      "quills.channel_accounts.sending_domain_id",
      "quills.import_runs.batch_tag_id",
      "quills.principal_role_assignments.team_id",
      "quills.role_permissions.permission_id",
      "quills.sla_policies.office_hours_schedule_id",
      "quills.status_incident_updates.template_id",
      "quills.teams.kaneo_team_id",
    ]);
  });

  it("renames live tags that differ only in case before 0015 makes the name unique", async () => {
    const migration = await readFile(
      resolve("drizzle/quills/0015_foreign_key_indexes.sql"),
      "utf8",
    );
    const statements = migration.split("--> statement-breakpoint");
    const dedupe = statements.find((sql) => sql.includes("DO $$"))!;
    const unique = statements.find((sql) =>
      sql.includes("conversation_tags_live_lower_name_idx"),
    )!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // The state before 0015, as two concurrent creates of "Bug" and "bug" left it.
      await client.query(
        "DROP INDEX quills.conversation_tags_live_lower_name_idx",
      );
      const tags = [
        [h.a, "00000000-0000-4000-8000-0000000000a1", "Bug", 4, false],
        [h.a, "00000000-0000-4000-8000-0000000000a2", "bug", 3, false],
        [h.a, "00000000-0000-4000-8000-0000000000a3", "BUG", 2, false],
        [h.a, "00000000-0000-4000-8000-0000000000a4", "bUg", 5, true],
        [h.a, "00000000-0000-4000-8000-0000000000a5", "Other", 1, false],
        [h.b, "00000000-0000-4000-8000-0000000000b1", "bug", 1, false],
      ] as const;
      for (const [workspaceId, id, name, days, archived] of tags)
        await client.query(
          "INSERT INTO quills.conversation_tags (workspace_id, id, name, created_at, deleted_at) VALUES ($1, $2, $3, now() - $4 * interval '1 day', CASE WHEN $5 THEN now() END)",
          [workspaceId, id, name, days, archived],
        );
      await client.query(dedupe);
      const { rows } = await client.query<{ id: string; name: string }>(
        "SELECT id::text, name FROM quills.conversation_tags WHERE workspace_id = ANY($1) ORDER BY id",
        [[h.a, h.b]],
      );
      expect(rows.map((row) => row.name)).toEqual([
        "Bug",
        "bug (0000000000a2)",
        "BUG (0000000000a3)",
        "bUg",
        "Other",
        "bug",
      ]);
      await client.query(unique);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
