import { typeIdColumnNullable } from "@kaneo/ids/drizzle";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { principal } from "./auth";

export const SPAM_BLOCK_KINDS = [
  "ip_cidr",
  "email_domain",
  "visitor_principal",
] as const;
export type SpamBlockKind = (typeof SPAM_BLOCK_KINDS)[number];

/**
 * Workspace-scoped spam blocklist (#320): blocks CIDR IP ranges, email domains, or
 * visitor principals from creating widget/portal conversations, posts, or comments.
 */
export const spamBlocks = quillsSchema
  .table(
    "spam_blocks",
    {
      workspaceId: workspaceColumn(),
      id: uuid("id").defaultRandom().notNull(),
      kind: text("kind").$type<SpamBlockKind>().notNull(),
      value: text("value").notNull(),
      reason: text("reason"),
      createdByPrincipalId: typeIdColumnNullable("principal")(
        "created_by_principal_id",
      ),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("spam_blocks_workspace_kind_value_uq").on(
        table.workspaceId,
        table.kind,
        table.value,
      ),
      index("spam_blocks_workspace_expires_idx").on(
        table.workspaceId,
        table.expiresAt,
      ),
      index("spam_blocks_created_by_idx").on(table.createdByPrincipalId),
      foreignKey({
        columns: [table.workspaceId, table.createdByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
        name: "spam_blocks_created_by_fk",
      }).onDelete("set null"),
      check(
        "spam_blocks_kind_value_check",
        sql`${table.kind} IN ('ip_cidr', 'email_domain', 'visitor_principal') AND char_length(${table.value}) BETWEEN 1 AND 255 AND (${table.reason} IS NULL OR char_length(${table.reason}) <= 500)`,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

export type SpamBlockRow = typeof spamBlocks.$inferSelect;
