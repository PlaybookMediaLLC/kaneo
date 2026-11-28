import { typeIdColumnNullable } from "@kaneo/ids/drizzle";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { principal } from "./auth";

export const SUPPORT_MERGE_ENTITY_KINDS = ["conversation", "ticket"] as const;
export type SupportMergeEntityKind =
  (typeof SUPPORT_MERGE_ENTITY_KINDS)[number];

export interface SupportMergeSnapshot {
  /** Message IDs moved from source conversation/ticket to target. */
  movedMessageIds: string[];
  /** Tag IDs copied onto target (removed on undo if newly added). */
  addedTagIds?: string[];
  /** Participant/watcher principal IDs newly added to target. */
  addedParticipantIds?: string[];
  /** Post/link IDs moved or added. */
  addedPostIds?: string[];
  /** System notice message ID inserted on target (deleted on undo). */
  targetNoticeMessageId?: string | null;
  /** System notice message ID inserted on source (deleted on undo). */
  sourceNoticeMessageId?: string | null;
  /** Source conversation/ticket status & resolution state before merge. */
  sourceBefore: {
    status: string;
    statusId?: string;
    resolvedAt: string | null;
    endReason?: string | null;
    endNote?: string | null;
    archivedAt?: string | null;
  };
  /** For ticket merges: whether the source ticket had a linked conversation that was also merged. */
  linkedConversationMergeId?: string | null;
}

/**
 * Audit and lossless-undo records for conversation and ticket merges (#322).
 */
export const supportMergeRecords = quillsSchema
  .table(
    "support_merge_records",
    {
      workspaceId: workspaceColumn(),
      id: uuid("id").defaultRandom().notNull(),
      entityKind: text("entity_kind").$type<SupportMergeEntityKind>().notNull(),
      sourceId: text("source_id").notNull(),
      targetId: text("target_id").notNull(),
      crossRequester: boolean("cross_requester").notNull().default(false),
      crossCompany: boolean("cross_company").notNull().default(false),
      notifyRequester: boolean("notify_requester").notNull().default(false),
      mergedByPrincipalId: typeIdColumnNullable("principal")(
        "merged_by_principal_id",
      ),
      snapshot: jsonb("snapshot").$type<SupportMergeSnapshot>().notNull(),
      undoneAt: timestamp("undone_at", { withTimezone: true }),
      undoneByPrincipalId: typeIdColumnNullable("principal")(
        "undone_by_principal_id",
      ),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      index("support_merge_records_ws_source_idx").on(
        table.workspaceId,
        table.entityKind,
        table.sourceId,
      ),
      index("support_merge_records_ws_target_idx").on(
        table.workspaceId,
        table.entityKind,
        table.targetId,
      ),
      foreignKey({
        columns: [table.workspaceId, table.mergedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
        name: "support_merge_records_merged_by_fk",
      }).onDelete("set null"),
      foreignKey({
        columns: [table.workspaceId, table.undoneByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
        name: "support_merge_records_undone_by_fk",
      }).onDelete("set null"),
      check(
        "support_merge_records_kind_check",
        sql`${table.entityKind} IN ('conversation', 'ticket') AND ${table.sourceId} <> ${table.targetId}`,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

export type SupportMergeRecordRow = typeof supportMergeRecords.$inferSelect;
