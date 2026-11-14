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
import { typeIdColumnNullable, typeIdWithDefault } from "@kaneo/ids/drizzle";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { postComments, posts } from "./posts";

/**
 * A cached machine translation of a post or a comment (RFC 0003, D10). The entity is the post
 * or the comment: exactly one of the two columns is set, so each has a tenant-safe foreign key
 * and a hard delete removes its translations. `source_hash` is the SHA-256 (hex) of the source
 * text: an edit gives a new hash, so a stale translation is never used. Retention removes old rows.
 */
export const contentTranslations = quillsSchema
  .table(
    "content_translations",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("content_translation")("id").notNull(),
      postId: typeIdColumnNullable("post")("post_id"),
      commentId: typeIdColumnNullable("post_comment")("comment_id"),
      locale: text("locale").notNull(),
      title: text("title"),
      content: text("content").notNull(),
      sourceHash: text("source_hash").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("content_translations_post_idx")
        .on(table.workspaceId, table.postId, table.locale, table.sourceHash)
        .where(sql`${table.postId} IS NOT NULL`),
      uniqueIndex("content_translations_comment_idx")
        .on(table.workspaceId, table.commentId, table.locale, table.sourceHash)
        .where(sql`${table.commentId} IS NOT NULL`),
      // Retention reads the oldest rows first.
      index("content_translations_created_at_idx").on(
        table.workspaceId,
        table.createdAt,
      ),
      check(
        "content_translations_entity_check",
        sql`num_nonnulls(${table.postId}, ${table.commentId}) = 1`,
      ),
      check(
        "content_translations_title_check",
        sql`${table.title} IS NULL OR char_length(${table.title}) <= 400`,
      ),
      check(
        "content_translations_locale_check",
        sql`char_length(${table.locale}) BETWEEN 2 AND 35`,
      ),
      check(
        "content_translations_content_check",
        sql`char_length(${table.content}) <= 20000`,
      ),
      check(
        "content_translations_source_hash_check",
        sql`${table.sourceHash} ~ '^[0-9a-f]{64}$'`,
      ),
      foreignKey({
        name: "content_translations_post_fk",
        columns: [table.workspaceId, table.postId],
        foreignColumns: [posts.workspaceId, posts.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "content_translations_comment_fk",
        columns: [table.workspaceId, table.commentId],
        foreignColumns: [postComments.workspaceId, postComments.id],
      }).onDelete("cascade"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
