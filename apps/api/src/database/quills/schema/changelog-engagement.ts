import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { typeIdColumn } from "@kaneo/ids/drizzle";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { FEEDBACK_REACTION_EMOJIS } from "../types";
import { principal } from "./auth";
import { changelogEntries } from "./changelog";

/** A customer's reaction to a changelog entry (RFC 0003, D9), from the comment reaction set. */
export const changelogReactions = quillsSchema
  .table(
    "changelog_reactions",
    {
      workspaceId: workspaceColumn(),
      changelogEntryId:
        typeIdColumn("changelog")("changelog_entry_id").notNull(),
      principalId: typeIdColumn("principal")("principal_id").notNull(),
      emoji: text("emoji", { enum: FEEDBACK_REACTION_EMOJIS }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      // Named: the default name is longer than the 63 bytes PostgreSQL keeps.
      primaryKey({
        name: "changelog_reactions_pk",
        columns: [
          table.workspaceId,
          table.changelogEntryId,
          table.principalId,
          table.emoji,
        ],
      }),
      index("changelog_reactions_principal_id_fk_idx").on(
        table.workspaceId,
        table.principalId,
      ),
      check(
        "changelog_reactions_emoji_check",
        sql`${table.emoji} IN (${sql.raw(FEEDBACK_REACTION_EMOJIS.map((emoji) => `'${emoji}'`).join(","))})`,
      ),
      foreignKey({
        name: "changelog_reactions_entry_fk",
        columns: [table.workspaceId, table.changelogEntryId],
        foreignColumns: [changelogEntries.workspaceId, changelogEntries.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "changelog_reactions_principal_fk",
        columns: [table.workspaceId, table.principalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("cascade"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

/** When a customer last read the changelog; entries published later are unread. */
export const changelogReads = quillsSchema
  .table(
    "changelog_reads",
    {
      workspaceId: workspaceColumn(),
      principalId: typeIdColumn("principal")("principal_id").notNull(),
      lastReadAt: timestamp("last_read_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.principalId] }),
      foreignKey({
        name: "changelog_reads_principal_fk",
        columns: [table.workspaceId, table.principalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("cascade"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
