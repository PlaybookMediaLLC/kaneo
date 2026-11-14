import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  typeIdColumn,
  typeIdColumnNullable,
  typeIdWithDefault,
} from "@kaneo/ids/drizzle";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { principal } from "./auth";
import { conversationMessages, conversations } from "./conversation";
import { posts } from "./posts";
import { tickets } from "./tickets";

/**
 * A feature request that a job extracted from a closed conversation or ticket (RFC 0003, D7).
 * A teammate accepts it (a new post, or a proxy vote on the matched post) or dismisses it.
 * The source is the conversation or the ticket: exactly one of the two columns is set, as on
 * `conversation_messages`. The source message is the dedupe key: one signal for each message,
 * so a retry of the extraction job cannot add a second signal.
 */
export const feedbackSignals = quillsSchema
  .table(
    "feedback_signals",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("feedback_signal")("id").notNull(),
      conversationId: typeIdColumnNullable("conversation")("conversation_id"),
      ticketId: typeIdColumnNullable("ticket")("ticket_id"),
      sourceMessageId:
        typeIdColumn("conversation_msg")("source_message_id").notNull(),
      /** The customer who asked. */
      principalId: typeIdColumn("principal")("principal_id").notNull(),
      excerpt: text("excerpt").notNull(),
      suggestedTitle: text("suggested_title").notNull(),
      matchedPostId: typeIdColumnNullable("post")("matched_post_id"),
      status: text("status", { enum: ["pending", "accepted", "dismissed"] })
        .notNull()
        .default("pending"),
      decidedByPrincipalId: typeIdColumnNullable("principal")(
        "decided_by_principal_id",
      ),
      decidedAt: timestamp("decided_at", { withTimezone: true }),
      /** The new post, or the matched post that got the proxy vote. */
      resultingPostId: typeIdColumnNullable("post")("resulting_post_id"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("feedback_signals_source_message_idx").on(
        table.workspaceId,
        table.sourceMessageId,
      ),
      // The teammate list: pending signals, newest first.
      index("feedback_signals_status_created_idx").on(
        table.workspaceId,
        table.status,
        table.createdAt,
      ),
      index("feedback_signals_conversation_id_fk_idx")
        .on(table.workspaceId, table.conversationId)
        .where(sql`${table.conversationId} IS NOT NULL`),
      index("feedback_signals_ticket_id_fk_idx")
        .on(table.workspaceId, table.ticketId)
        .where(sql`${table.ticketId} IS NOT NULL`),
      index("feedback_signals_principal_id_fk_idx").on(
        table.workspaceId,
        table.principalId,
      ),
      index("feedback_signals_matched_post_id_fk_idx")
        .on(table.workspaceId, table.matchedPostId)
        .where(sql`${table.matchedPostId} IS NOT NULL`),
      index("feedback_signals_resulting_post_id_fk_idx")
        .on(table.workspaceId, table.resultingPostId)
        .where(sql`${table.resultingPostId} IS NOT NULL`),
      index("feedback_signals_decided_by_principal_id_fk_idx")
        .on(table.workspaceId, table.decidedByPrincipalId)
        .where(sql`${table.decidedByPrincipalId} IS NOT NULL`),
      check(
        "feedback_signals_source_check",
        sql`num_nonnulls(${table.conversationId}, ${table.ticketId}) = 1`,
      ),
      check(
        "feedback_signals_status_check",
        sql`${table.status} IN ('pending','accepted','dismissed')`,
      ),
      // A decision has a time; a pending signal has none.
      check(
        "feedback_signals_decided_check",
        sql`(${table.status} = 'pending') = (${table.decidedAt} IS NULL)`,
      ),
      check(
        "feedback_signals_excerpt_check",
        sql`char_length(${table.excerpt}) BETWEEN 1 AND 2000`,
      ),
      check(
        "feedback_signals_suggested_title_check",
        sql`char_length(${table.suggestedTitle}) BETWEEN 1 AND 200`,
      ),
      foreignKey({
        name: "feedback_signals_conversation_fk",
        columns: [table.workspaceId, table.conversationId],
        foreignColumns: [conversations.workspaceId, conversations.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "feedback_signals_ticket_fk",
        columns: [table.workspaceId, table.ticketId],
        foreignColumns: [tickets.workspaceId, tickets.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "feedback_signals_source_message_fk",
        columns: [table.workspaceId, table.sourceMessageId],
        foreignColumns: [
          conversationMessages.workspaceId,
          conversationMessages.id,
        ],
      }).onDelete("cascade"),
      foreignKey({
        name: "feedback_signals_principal_fk",
        columns: [table.workspaceId, table.principalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "feedback_signals_matched_post_fk",
        columns: [table.workspaceId, table.matchedPostId],
        foreignColumns: [posts.workspaceId, posts.id],
      }).onDelete("set null"),
      foreignKey({
        name: "feedback_signals_resulting_post_fk",
        columns: [table.workspaceId, table.resultingPostId],
        foreignColumns: [posts.workspaceId, posts.id],
      }).onDelete("set null"),
      foreignKey({
        name: "feedback_signals_decided_by_principal_fk",
        columns: [table.workspaceId, table.decidedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
