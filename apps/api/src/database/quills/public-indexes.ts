import type { Client } from "pg";

interface PublicBridgeIndexSpec {
  name: string;
  table: string;
  ddl: string;
}

/**
 * Idempotent operational indexes on upstream Kaneo `public.*` tables.
 *
 * Kept outside `apps/api/drizzle/` and `_journal.json` on purpose so nightly upstream syncs
 * never conflict on migration numbering. Every index name uses the `quills_bridge_` prefix
 * so it can coexist cleanly if upstream later adds its own index on the same columns.
 */
export const PUBLIC_BRIDGE_INDEX_SPECS: readonly PublicBridgeIndexSpec[] = [
  {
    name: "quills_bridge_workspace_member_ws_user_idx",
    table: "workspace_member",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_workspace_member_ws_user_idx ON public."workspace_member" (workspace_id, user_id)',
  },
  {
    name: "quills_bridge_workspace_role_ws_role_idx",
    table: "workspace_role",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_workspace_role_ws_role_idx ON public."workspace_role" (workspace_id, role)',
  },
  {
    name: "quills_bridge_task_project_pos_id_idx",
    table: "task",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_task_project_pos_id_idx ON public."task" (project_id, position, id)',
  },
  {
    name: "quills_bridge_task_project_status_pos_idx",
    table: "task",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_task_project_status_pos_idx ON public."task" (project_id, status, position, id)',
  },
  {
    name: "quills_bridge_notification_user_created_idx",
    table: "notification",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_notification_user_created_idx ON public."notification" (user_id, created_at DESC)',
  },
  {
    name: "quills_bridge_notification_user_unread_idx",
    table: "notification",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_notification_user_unread_idx ON public."notification" (user_id, created_at DESC) WHERE is_read = false',
  },
  {
    name: "quills_bridge_activity_task_created_idx",
    table: "activity",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_activity_task_created_idx ON public."activity" (task_id, created_at DESC)',
  },
  {
    name: "quills_bridge_task_relation_target_type_idx",
    table: "task_relation",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_task_relation_target_type_idx ON public."task_relation" (target_task_id, relation_type)',
  },
  {
    name: "quills_bridge_task_relation_source_type_idx",
    table: "task_relation",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_task_relation_source_type_idx ON public."task_relation" (source_task_id, relation_type, target_task_id)',
  },
  {
    name: "quills_bridge_column_project_pos_idx",
    table: "column",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_column_project_pos_idx ON public."column" (project_id, position, id)',
  },
  {
    name: "quills_bridge_account_user_provider_idx",
    table: "account",
    ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_account_user_provider_idx ON public."account" (user_id, provider_id)',
  },
];

/**
 * Ensures the idempotent `public.*` performance bridge indexes exist and repairs any
 * interrupted invalid builds. Runs outside transactions (`CREATE INDEX CONCURRENTLY`).
 */
export async function ensurePublicPerformanceIndexes(
  client: Client,
  specs: readonly PublicBridgeIndexSpec[] = PUBLIC_BRIDGE_INDEX_SPECS,
): Promise<void> {
  const tables = [...new Set(specs.map((spec) => spec.table))];
  const existing = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1)`,
    [tables],
  );
  const presentTables = new Set(existing.rows.map((row) => row.relname));

  const indexStates = await client.query<{ relname: string; valid: boolean }>(
    `SELECT c.relname, i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
    [specs.map((spec) => spec.name)],
  );
  const stateByName = new Map(
    indexStates.rows.map((row) => [row.relname, row.valid]),
  );

  for (const spec of specs) {
    if (!presentTables.has(spec.table)) continue;
    const valid = stateByName.get(spec.name);
    if (valid === true) continue;
    try {
      if (valid === false)
        await client.query(`DROP INDEX CONCURRENTLY public."${spec.name}"`);
      await client.query(spec.ddl);
    } catch (error) {
      // Split-privilege QUILLS_MIGRATION_DATABASE_URL roles may not own public.* tables.
      if ((error as { code?: string })?.code === "42501") {
        console.warn(
          `Skipping public bridge index ${spec.name}: migration role lacks ownership on public.${spec.table}`,
        );
        continue;
      }
      throw error;
    }
  }
}
