import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { primaryKey } from "drizzle-orm/pg-core";
/**
 * Export runs and scheduled S3/R2 workspace backup configurations (#327).
 *
 * One row per async or synchronous workspace export job: CSV single-entity or
 * full workspace .zip archive (NDJSON + Markdown KB + manifest + attachments).
 */
import {
  boolean,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  foreignKey,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { typeIdWithDefault, typeIdColumn } from "@kaneo/ids/drizzle";
import { principal } from "./auth";

export type ExportRunStatus = "pending" | "running" | "completed" | "failed";
export type ExportRunFormat = "csv" | "zip";
export type ExportScheduleCadence = "daily" | "weekly" | "monthly";

/** Per-entity row counts written into the zip manifest, e.g. { posts: 1204 }. */
export type ExportRunEntityCounts = Record<string, number>;

export const exportRuns = quillsSchema
  .table(
    "export_runs",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("export_run")("id").notNull(),
      status: text("status", {
        enum: ["pending", "running", "completed", "failed"],
      })
        .$type<ExportRunStatus>()
        .notNull()
        .default("pending"),
      format: text("format", { enum: ["csv", "zip"] })
        .$type<ExportRunFormat>()
        .notNull()
        .default("csv"),
      since: timestamp("since", { withTimezone: true }),
      // Download name presented to the admin (quackback-export-<slug>-<date>.zip).
      fileName: text("file_name").notNull(),
      // Bucket object key (exports/<runId>.zip). Null until the upload lands.
      s3Key: text("s3_key"),
      // Compressed zip size. integer is plenty: 2GB compressed ≈ 20GB of text.
      sizeBytes: integer("size_bytes"),
      fileCount: integer("file_count").notNull().default(0),
      entityCounts: jsonb("entity_counts").$type<ExportRunEntityCounts>(),
      manifestJson: jsonb("manifest_json").$type<Record<string, unknown>>(),
      // Failure reason surfaced in the hub history when status='failed'.
      error: text("error"),
      initiatedByPrincipalId: typeIdColumn("principal")(
        "initiated_by_principal_id",
      ).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      finishedAt: timestamp("finished_at", { withTimezone: true }),
      // Download cut-off (finished_at + retention). Enforced at download time;
      // the worker deletes the row + object once past this.
      expiresAt: timestamp("expires_at", { withTimezone: true }),
    },
    (table) => [
      foreignKey({
        name: "export_runs_initiated_by_principal_id_fkey",
        columns: [table.workspaceId, table.initiatedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("restrict"),
      index("export_runs_status_idx").on(table.status),
      index("export_runs_created_at_idx").on(table.createdAt),
      // At most one active (pending/running) run per deployment: a second
      // concurrent insert conflicts here and the route maps it to 409.
      uniqueIndex("export_runs_active_idx")
        .on(table.workspaceId, sql`(1)`)
        .where(sql`"status" IN ('pending', 'running')`),
      primaryKey({ columns: [table.workspaceId, table.id] }),
      index("export_runs_initiated_by_principal_id_fk_idx").on(
        table.workspaceId,
        table.initiatedByPrincipalId,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/** Scheduled workspace backup target (S3/R2) with sealed credentials (#327). Omitted from exports. */
export const exportSchedules = quillsSchema
  .table(
    "export_schedules",
    {
      workspaceId: workspaceColumn(),
      id: uuid("id").defaultRandom().notNull(),
      enabled: boolean("enabled").notNull().default(true),
      cadence: text("cadence", { enum: ["daily", "weekly", "monthly"] })
        .$type<ExportScheduleCadence>()
        .notNull()
        .default("weekly"),
      destinationEndpoint: text("destination_endpoint").notNull(),
      bucket: text("bucket").notNull(),
      prefix: text("prefix").notNull().default("kaneo-backups/"),
      region: text("region").notNull().default("auto"),
      /** Sealed via sealCredentials({ accessKeyId, secretAccessKey }). Never returned. */
      sealedCredentials: text("sealed_credentials").notNull(),
      lastRunAt: timestamp("last_run_at", { withTimezone: true }),
      nextRunAt: timestamp("next_run_at", { withTimezone: true }),
      lastStatus: text("last_status"),
      lastError: text("last_error"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

export const exportRunsRelations = relations(exportRuns, ({ one }) => ({
  initiatedBy: one(principal, {
    fields: [exportRuns.workspaceId, exportRuns.initiatedByPrincipalId],
    references: [principal.workspaceId, principal.id],
  }),
}));
