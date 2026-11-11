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
import { principal } from "./auth";

/**
 * A portal invite gives one email address access to a private portal (decision D1). It never
 * grants workspace membership. Only SHA-256 hashes of the invite tokens are stored: each send
 * and each copied link adds one, and accepting or canceling makes every token useless.
 */
export const portalInvites = quillsSchema
  .table(
    "portal_invites",
    {
      workspaceId: workspaceColumn(),
      id: typeIdWithDefault("invite")("id").notNull(),
      /** Lowercase. */
      email: text("email").notNull(),
      /** The sender's optional note, mailed with the first invite only. */
      message: text("message"),
      status: text("status", {
        enum: ["pending", "accepted", "canceled", "expired"],
      })
        .notNull()
        .default("pending"),
      tokenHashes: text("token_hashes")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      invitedByPrincipalId: typeIdColumnNullable("principal")(
        "invited_by_principal_id",
      ),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
      acceptedAt: timestamp("accepted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      // One open invite per address; the database keeps it under concurrent sends.
      uniqueIndex("portal_invites_pending_email_idx")
        .on(table.workspaceId, table.email)
        .where(sql`${table.status} = 'pending'`),
      // The access check reads accepted invites by address.
      index("portal_invites_email_status_idx").on(
        table.workspaceId,
        table.email,
        table.status,
      ),
      check(
        "portal_invites_status_check",
        sql`${table.status} IN ('pending','accepted','canceled','expired')`,
      ),
      check(
        "portal_invites_token_hashes_check",
        sql`cardinality(${table.tokenHashes}) <= 20`,
      ),
      foreignKey({
        columns: [table.workspaceId, table.invitedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
      }).onDelete("set null"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
