import { desc, eq } from "drizzle-orm";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import { exportRuns } from "../../../database/quills/schema/export-runs";
import { importRuns } from "../../../database/quills/schema/import-runs";
import { defineQuillsRoute } from "../../framework/define-route";

// Run history for Settings > Imports & exports. An export holds rows that its initiator can read, so
// export runs are visible only to the teammate who started them. Import runs are workspace history.

export const exportRunItem = z.object({
  id: z.string(),
  status: z.enum(exportRuns.status.enumValues),
  fileName: z.string(),
  sizeBytes: z.number().nullable(),
  /** Rows in the file, by export kind. */
  entityCounts: z
    .object({
      posts: z.number().optional(),
      users: z.number().optional(),
      companies: z.number().optional(),
      conversations: z.number().optional(),
    })
    .nullable(),
  error: z.string().nullable(),
  createdAt: responseTimestamp,
  finishedAt: nullableResponseTimestamp,
  expiresAt: nullableResponseTimestamp,
});
export const exportRunFields = {
  id: exportRuns.id,
  status: exportRuns.status,
  fileName: exportRuns.fileName,
  sizeBytes: exportRuns.sizeBytes,
  entityCounts: exportRuns.entityCounts,
  error: exportRuns.error,
  createdAt: exportRuns.createdAt,
  finishedAt: exportRuns.finishedAt,
  expiresAt: exportRuns.expiresAt,
};

export const importRunItem = z.object({
  id: z.string(),
  source: z.enum(importRuns.source.enumValues),
  fileName: z.string(),
  status: z.enum(importRuns.status.enumValues),
  totals: z
    .object({
      rows: z.number(),
      created: z.number(),
      updated: z.number(),
      skipped: z.number(),
      errors: z.number(),
    })
    .nullable(),
  errorReport: z
    .array(
      z.object({
        row: z.number(),
        message: z.string(),
        field: z.string().optional(),
      }),
    )
    .nullable(),
  createdAt: responseTimestamp,
  finishedAt: nullableResponseTimestamp,
});
export const importRunFields = {
  id: importRuns.id,
  source: importRuns.source,
  fileName: importRuns.fileName,
  status: importRuns.status,
  totals: importRuns.totals,
  errorReport: importRuns.errorReport,
  createdAt: importRuns.createdAt,
  finishedAt: importRuns.finishedAt,
};

const page = z.object({ limit: pagingNumber(1, 50, 20) });

const listExportRuns = defineQuillsRoute({
  method: "get",
  path: "/transfer/export-runs",
  operationId: "listQuillsExportRuns",
  summary: "List the caller's export runs, newest first",
  description:
    "Only the runs that the caller started: an export holds the rows that its initiator can read.",
  action: "manage_settings",
  query: page,
  response: z.object({ items: z.array(exportRunItem) }),
  responseDescription: "Export runs",
  handler: async ({ db, actor, query }) => ({
    items: await db
      .select(exportRunFields)
      .from(exportRuns)
      .where(eq(exportRuns.initiatedByPrincipalId, actor.principalId))
      .orderBy(desc(exportRuns.createdAt), desc(exportRuns.id))
      .limit(query.limit),
  }),
});

const listImportRuns = defineQuillsRoute({
  method: "get",
  path: "/transfer/import-runs",
  operationId: "listQuillsImportRuns",
  summary: "List the workspace's import runs, newest first",
  action: "manage_settings",
  query: page,
  response: z.object({ items: z.array(importRunItem) }),
  responseDescription: "Import runs",
  handler: async ({ db, query }) => ({
    items: await db
      .select(importRunFields)
      .from(importRuns)
      .orderBy(desc(importRuns.createdAt), desc(importRuns.id))
      .limit(query.limit),
  }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listExportRuns)
  .openapi(...listImportRuns);
