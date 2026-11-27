import type { Client } from "pg";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  ensurePublicPerformanceIndexes,
  PUBLIC_BRIDGE_INDEX_SPECS,
} from "./public-indexes";

describe("ensurePublicPerformanceIndexes", () => {
  it("uses only quills_bridge_ CONCURRENTLY IF NOT EXISTS specs", () => {
    expect(PUBLIC_BRIDGE_INDEX_SPECS.length).toBeGreaterThan(0);
    for (const spec of PUBLIC_BRIDGE_INDEX_SPECS) {
      expect(spec.name).toMatch(/^quills_bridge_/);
      expect(spec.ddl).toMatch(/^CREATE INDEX CONCURRENTLY IF NOT EXISTS /);
    }
  });

  it("skips valid indexes and missing tables, creates missing ones, and repairs invalid builds", async () => {
    const executed: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        executed.push(sql);
        if (sql.includes("FROM pg_class")) {
          return {
            rows: [{ relname: "workspace_member" }, { relname: "task" }],
          };
        }
        if (sql.includes("FROM pg_index")) {
          return {
            rows: [
              {
                relname: "quills_bridge_workspace_member_ws_user_idx",
                valid: true,
              },
              {
                relname: "quills_bridge_task_project_pos_id_idx",
                valid: false,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as Client;

    await ensurePublicPerformanceIndexes(client, [
      {
        name: "quills_bridge_workspace_member_ws_user_idx",
        table: "workspace_member",
        ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_workspace_member_ws_user_idx ON public."workspace_member" (workspace_id, user_id)',
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
        name: "quills_bridge_account_user_provider_idx",
        table: "account",
        ddl: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_account_user_provider_idx ON public."account" (user_id, provider_id)',
      },
    ]);

    expect(executed.slice(2)).toEqual([
      'DROP INDEX CONCURRENTLY public."quills_bridge_task_project_pos_id_idx"',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_task_project_pos_id_idx ON public."task" (project_id, position, id)',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS quills_bridge_task_project_status_pos_idx ON public."task" (project_id, status, position, id)',
    ]);
  });
});
