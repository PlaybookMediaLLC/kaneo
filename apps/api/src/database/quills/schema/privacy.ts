import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { typeIdColumnNullable, typeIdWithDefault } from "@kaneo/ids/drizzle";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { principal } from "./auth";

export const RETENTION_CHANNELS = [
  "all",
  "messenger",
  "email",
  "widget",
  "ticket",
] as const;
export type RetentionChannel = (typeof RETENTION_CHANNELS)[number];

export const RETENTION_ACTIONS = ["delete", "anonymize"] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];

export const PRIVACY_REQUEST_TYPES = ["erasure", "access"] as const;
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export const PRIVACY_REQUEST_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export type PrivacyRequestSummary = {
  conversations?: number;
  messages?: number;
  files?: number;
  posts?: number;
  comments?: number;
  votes?: number;
  tickets?: number;
  surveyResponses?: number;
  aiLogs?: number;
  emailLogs?: number;
  subscriptions?: number;
  mode?: "anonymize" | "delete";
  exportBytes?: number;
  attachmentCount?: number;
};

/**
 * Per-workspace / per-channel retention schedules (#329). Null day counts mean "retain indefinitely".
 * Enforced by the hourly retention sweep after snapshotting immutable counts into support_daily_stats.
 */
export const retentionPolicies = quillsSchema
  .table(
    "retention_policies",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("retention_policy")("id").notNull(),
      channel: text("channel", { enum: RETENTION_CHANNELS }).notNull(),
      action: text("action", { enum: RETENTION_ACTIONS })
        .notNull()
        .default("delete"),
      closedAfterDays: integer("closed_after_days"),
      spamAfterDays: integer("spam_after_days"),
      softDeletedAfterDays: integer("soft_deleted_after_days"),
      aiLogsAfterDays: integer("ai_logs_after_days"),
      updatedByPrincipalId: typeIdColumnNullable("principal")(
        "updated_by_principal_id",
      ),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      unique("retention_policies_workspace_channel_unique").on(
        table.workspaceId,
        table.channel,
      ),
      foreignKey({
        name: "retention_policies_updated_by_principal_id_fkey",
        columns: [table.workspaceId, table.updatedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      check(
        "retention_policies_channel_check",
        sql`${table.channel} IN ('all','messenger','email','widget','ticket')`,
      ),
      check(
        "retention_policies_action_check",
        sql`${table.action} IN ('delete','anonymize')`,
      ),
      check(
        "retention_policies_days_check",
        sql`(${table.closedAfterDays} IS NULL OR (${table.closedAfterDays} >= 1 AND ${table.closedAfterDays} <= 3650))
          AND (${table.spamAfterDays} IS NULL OR (${table.spamAfterDays} >= 1 AND ${table.spamAfterDays} <= 3650))
          AND (${table.softDeletedAfterDays} IS NULL OR (${table.softDeletedAfterDays} >= 1 AND ${table.softDeletedAfterDays} <= 3650))
          AND (${table.aiLogsAfterDays} IS NULL OR (${table.aiLogsAfterDays} >= 1 AND ${table.aiLogsAfterDays} <= 3650))`,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/**
 * Compliance receipts for per-customer erasure and data-subject access/portability requests (#329).
 * Stores only a SHA-256 hash of the subject's normalized email — never plaintext PII — so an
 * erasure receipt remains valid compliance evidence after the customer's PII is completely gone.
 */
export const privacyRequests = quillsSchema
  .table(
    "privacy_requests",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("privacy_request")("id").notNull(),
      type: text("type", { enum: PRIVACY_REQUEST_TYPES }).notNull(),
      mode: text("mode", { enum: RETENTION_ACTIONS }),
      subjectPrincipalId: typeIdColumnNullable("principal")(
        "subject_principal_id",
      ),
      subjectEmailHash: text("subject_email_hash"),
      status: text("status", { enum: PRIVACY_REQUEST_STATUSES })
        .notNull()
        .default("pending"),
      requestedByPrincipalId: typeIdColumnNullable("principal")(
        "requested_by_principal_id",
      ),
      summary: jsonb("summary")
        .$type<PrivacyRequestSummary>()
        .notNull()
        .default({}),
      exportS3Key: text("export_s3_key"),
      exportFileName: text("export_file_name"),
      exportExpiresAt: timestamp("export_expires_at", { withTimezone: true }),
      error: text("error"),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      foreignKey({
        name: "privacy_requests_subject_principal_id_fkey",
        columns: [table.workspaceId, table.subjectPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      foreignKey({
        name: "privacy_requests_requested_by_principal_id_fkey",
        columns: [table.workspaceId, table.requestedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      index("privacy_requests_workspace_created_idx").on(
        table.workspaceId,
        table.createdAt,
      ),
      index("privacy_requests_workspace_type_status_idx").on(
        table.workspaceId,
        table.type,
        table.status,
      ),
      check(
        "privacy_requests_type_check",
        sql`${table.type} IN ('erasure','access')`,
      ),
      check(
        "privacy_requests_status_check",
        sql`${table.status} IN ('pending','running','completed','failed')`,
      ),
      check(
        "privacy_requests_mode_check",
        sql`${table.mode} IS NULL OR ${table.mode} IN ('delete','anonymize')`,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/**
 * Immutable archived support aggregate counts snapshotted before retention or erasure purges
 * conversation/SLA rows (#329). Support reporting combines live rows with these archived counters
 * so historical totals stay unchanged after eligible rows are deleted.
 */
export const supportDailyStats = quillsSchema
  .table(
    "support_daily_stats",
    {
      workspaceId: workspaceColumn(),
      day: text("day").notNull(),
      channel: text("channel").notNull(),
      conversationsCreated: integer("conversations_created")
        .notNull()
        .default(0),
      conversationsResolved: integer("conversations_resolved")
        .notNull()
        .default(0),
      messagesCount: integer("messages_count").notNull().default(0),
      slaFirstResponseMet: integer("sla_first_response_met")
        .notNull()
        .default(0),
      slaFirstResponseBreached: integer("sla_first_response_breached")
        .notNull()
        .default(0),
      slaNextResponseMet: integer("sla_next_response_met").notNull().default(0),
      slaNextResponseBreached: integer("sla_next_response_breached")
        .notNull()
        .default(0),
      slaResolutionMet: integer("sla_resolution_met").notNull().default(0),
      slaResolutionBreached: integer("sla_resolution_breached")
        .notNull()
        .default(0),
      slaTimeToResolveMet: integer("sla_time_to_resolve_met")
        .notNull()
        .default(0),
      slaTimeToResolveBreached: integer("sla_time_to_resolve_breached")
        .notNull()
        .default(0),
      csatSum: integer("csat_sum").notNull().default(0),
      csatCount: integer("csat_count").notNull().default(0),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.day, table.channel] }),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
