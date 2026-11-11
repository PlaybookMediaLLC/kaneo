import { fromUuid } from "@kaneo/ids";
import { sql } from "drizzle-orm";
import type { Database } from "../../database/quills/client";

const BATCH = 1000;
const CURSOR = "retention:anonymous-visitors";

/**
 * Deletes anonymous widget visitors (widget/feedback/session.ts) whose session ended, that still
 * hold only what that route wrote, and that no row references: no content, vote, conversation or
 * other row. Every foreign key to principal and customer_identity is read from the catalog, so a
 * new table is checked too. The candidates are locked first; a write that references one waits for
 * this transaction, then fails. A kv_store cursor moves past the visitors that stay, so they cannot
 * fill every batch; after the newest batch the sweep starts again from the oldest.
 */
export async function pruneAnonymousVisitors(tx: Database) {
  const [cursor] = (
    await tx.execute<{ created_at: string; id: string }>(
      sql`SELECT value->>'createdAt' AS created_at, value->>'id' AS id FROM quills.kv_store WHERE workspace_key='_' AND key=${CURSOR} AND expires_at>now()`,
    )
  ).rows;
  // ponytail: the session lasts 7 days from creation (WIDGET_SESSION_TTL_MS in framework/audience.ts),
  // plus one day of margin. A longer session needs this age raised; live sessions are also checked.
  // A teammate (directory/people.ts, company, block) or the visitor can add data; that keeps the visitor.
  const candidates = await tx.execute<{ id: string; created_at: string }>(
    sql`SELECT p.id::text, p.created_at::text FROM quills.principal p JOIN quills.customer_identity c ON c.workspace_id=p.workspace_id AND c.id=p.user_id
      WHERE p.type='anonymous' AND p.created_at<now()-interval '8 days'
      ${cursor ? sql`AND (p.created_at,p.id)>(${cursor.created_at}::timestamptz,${cursor.id}::uuid)` : sql``}
      AND p.display_name IS NULL AND p.avatar_url IS NULL AND p.contact_email IS NULL AND p.company_id IS NULL AND p.blocked_at IS NULL
      AND c.is_anonymous AND c.name='Anonymous' AND c.email IS NULL AND c.image IS NULL AND c.external_id IS NULL AND c.metadata IS NULL
      ORDER BY p.created_at, p.id LIMIT ${BATCH} FOR UPDATE OF p SKIP LOCKED`,
  );
  const last = candidates.rows.at(-1);
  if (last && candidates.rows.length === BATCH)
    await tx.execute(
      sql`INSERT INTO quills.kv_store (workspace_key,key,value,expires_at) VALUES ('_',${CURSOR},${JSON.stringify({ createdAt: last.created_at, id: last.id })}::jsonb,now()+interval '30 days') ON CONFLICT (workspace_id,workspace_key,key) DO UPDATE SET value=EXCLUDED.value, expires_at=EXCLUDED.expires_at`,
    );
  else if (cursor)
    await tx.execute(
      sql`DELETE FROM quills.kv_store WHERE workspace_key='_' AND key=${CURSOR}`,
    );
  if (!last) return 0;
  // A widget session stores the principal's TypeID.
  const ended = new Map<string, string>(
    candidates.rows.map((row) => [fromUuid("principal", row.id), row.id]),
  );
  const live = await tx.execute<{ id: string }>(
    sql`SELECT value->>'principalId' AS id FROM quills.kv_store WHERE expires_at>now() AND value->>'principalId' IN ${[...ended.keys()]}`,
  );
  for (const row of live.rows) ended.delete(row.id);
  const principals = await unreferenced(tx, "principal", [...ended.values()]);
  if (!principals.length) return 0;
  const deleted = await tx.execute<{ user_id: string }>(
    sql`DELETE FROM quills.principal WHERE type='anonymous' AND id IN ${principals} RETURNING user_id::text`,
  );
  // After its principal: a profile that something else references stays.
  const identities = await unreferenced(
    tx,
    "customer_identity",
    deleted.rows.map((row) => row.user_id),
  );
  const removed = identities.length
    ? await tx.execute(
        sql`DELETE FROM quills.customer_identity WHERE is_anonymous AND id IN ${identities}`,
      )
    : { rowCount: 0 };
  return (deleted.rowCount ?? 0) + (removed.rowCount ?? 0);
}

/** The given IDs of `parent` rows that no foreign key references. */
async function unreferenced(
  tx: Database,
  parent: "principal" | "customer_identity",
  ids: string[],
) {
  const left = new Set(ids);
  const keys = await tx.execute<{ tbl: string; col: string }>(
    sql`SELECT c.conrelid::regclass::text AS tbl, a.attname AS col FROM pg_constraint c JOIN pg_attribute k ON k.attrelid=c.confrelid AND k.attname='id' JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[array_position(c.confkey,k.attnum)] WHERE c.contype='f' AND c.conparentid=0 AND c.confrelid=${`quills.${parent}`}::regclass`,
  );
  for (const { tbl, col } of keys.rows) {
    if (!left.size) break;
    const found = await tx.execute<{ id: string }>(
      sql`SELECT DISTINCT ${sql.identifier(col)}::text AS id FROM ${sql.raw(tbl)} WHERE ${sql.identifier(col)} IN ${[...left]}`,
    );
    for (const row of found.rows) left.delete(row.id);
  }
  return [...left];
}
