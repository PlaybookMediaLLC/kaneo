import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { foreignKey, primaryKey } from "drizzle-orm/pg-core";
/**
 * Webhooks schema for external event notifications
 *
 * Webhooks are created by admins and used to notify external services
 * when events occur in Quackback (post.created, post.status_changed, comment.created).
 */
import { text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { typeIdWithDefault, typeIdColumn } from "@kaneo/ids/drizzle";
import { principal } from "./auth";

/**
 * Webhooks table
 *
 * Stores webhook configurations for external integrations.
 * The signing secret is only shown once on creation.
 */
export const webhooks = quillsSchema
  .table(
    "webhooks",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("webhook")("id").notNull(),
      /** Principal who created this webhook */
      createdById: typeIdColumn("principal")("created_by_id").notNull(),
      /** HTTPS endpoint URL to receive webhook payloads */
      url: text("url").notNull(),
      /** Encrypted secret for HMAC-SHA256 signing (AES-256-GCM encrypted) */
      secret: text("secret").notNull(),
      /** Event types to trigger this webhook */
      events: text("events").array().notNull(),
      /** Optional filter: only trigger for posts in these boards */
      boardIds: text("board_ids").array(),
      /** Webhook status: active or disabled */
      status: text("status", { enum: ["active", "disabled"] })
        .notNull()
        .default("active"),
      /** Consecutive delivery failures (reset on success) */
      failureCount: integer("failure_count").notNull().default(0),
      /** Last error message from failed delivery */
      lastError: text("last_error"),
      /** When the webhook was last triggered */
      lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
      /** When admins were last alerted for consecutive failures (#330) */
      lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
      /** When the webhook was created */
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      /** When the webhook was last updated */
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      /** Soft delete support */
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => [
      // Index for finding active webhooks
      index("webhooks_status_idx").on(table.status),
      // Index for listing webhooks by creator
      index("webhooks_created_by_id_idx").on(table.createdById),
      // Index for soft delete filtering
      index("webhooks_deleted_at_idx").on(table.deletedAt),
      primaryKey({ columns: [table.workspaceId, table.id] }),
      foreignKey({
        columns: [table.workspaceId, table.createdById],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("cascade"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/**
 * Webhook delivery attempt log (#330). Ephemeral operational log (pruned by retention,
 * omitted from workspace transfer archives). Stores bounded response snippets (<= 2 KB).
 */
export const webhookDeliveries = quillsSchema
  .table(
    "webhook_deliveries",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("webhook_delivery")("id").notNull(),
      webhookId: typeIdColumn("webhook")("webhook_id").notNull(),
      eventId: text("event_id").notNull(),
      eventType: text("event_type").notNull(),
      attempt: integer("attempt").notNull().default(1),
      status: text("status", {
        enum: ["succeeded", "failed", "retrying"],
      }).notNull(),
      httpStatus: integer("http_status"),
      durationMs: integer("duration_ms"),
      responseSnippet: text("response_snippet"),
      error: text("error"),
      deliveredAt: timestamp("delivered_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      foreignKey({
        columns: [table.workspaceId, table.webhookId],
        foreignColumns: [webhooks.workspaceId, webhooks.id],
      }).onDelete("cascade"),
      index("webhook_deliveries_webhook_created_idx").on(
        table.webhookId,
        table.createdAt,
      ),
      index("webhook_deliveries_created_at_idx").on(table.createdAt),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

export const webhooksRelations = relations(webhooks, ({ one }) => ({
  createdBy: one(principal, {
    fields: [webhooks.workspaceId, webhooks.createdById],
    references: [principal.workspaceId, principal.id],
  }),
}));
