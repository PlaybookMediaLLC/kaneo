import { typeIdColumn, typeIdColumnNullable } from "@kaneo/ids/drizzle";
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";
import { principal } from "./auth";

export const CONTACT_IDENTITY_KINDS = [
  "email",
  "external_id",
  "phone",
  "slack_id",
  "github_id",
] as const;
export type ContactIdentityKind = (typeof CONTACT_IDENTITY_KINDS)[number];

/**
 * Multi-identity links for a contact principal (#310): lets one customer hold
 * multiple emails (work + personal), external user IDs, phone numbers, Slack IDs,
 * and GitHub handles so cross-channel messages resolve to the same person.
 */
export const contactIdentities = quillsSchema
  .table(
    "contact_identities",
    {
      workspaceId: workspaceColumn(),
      id: uuid("id").defaultRandom().notNull(),
      principalId: typeIdColumn("principal")("principal_id").notNull(),
      kind: text("kind").$type<ContactIdentityKind>().notNull(),
      value: text("value").notNull(),
      verified: boolean("verified").notNull().default(false),
      source: text("source").notNull().default("manual"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.id] }),
      uniqueIndex("contact_identities_ws_kind_value_uq").on(
        table.workspaceId,
        table.kind,
        sql`lower(${table.value})`,
      ),
      index("contact_identities_ws_principal_idx").on(
        table.workspaceId,
        table.principalId,
      ),
      foreignKey({
        columns: [table.workspaceId, table.principalId],
        foreignColumns: [principal.workspaceId, principal.id],
        name: "contact_identities_principal_fk",
      }).onDelete("cascade"),
      check(
        "contact_identities_kind_value_check",
        sql`${table.kind} IN ('email','external_id','phone','slack_id','github_id') AND char_length(${table.value}) BETWEEN 1 AND 320`,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

export interface ContactMergeSnapshot {
  /** Primary-key values of rows repointed from source to target, keyed by table name. */
  movedIds: Record<string, string[]>;
  /**
   * Full row payloads of colliding rows that were removed during merge so
   * undo can re-insert them losslessly (votes, subscriptions, tags, preferences).
   */
  stashedRows: Record<string, Record<string, unknown>[]>;
  /** Target principal fields overwritten from source when target was null. */
  targetBefore: {
    contactEmail: string | null;
    companyId: string | null;
    blockedAt: string | null;
    blockedByPrincipalId: string | null;
  };
  /** Identities copied onto target from source (identity IDs to move back on undo). */
  movedIdentityIds: string[];
}

/**
 * Reversible contact merge audit & snapshot (#310): supports 30-day lossless undo
 * of any manual or bulk contact merge.
 */
export const contactMerges = quillsSchema
  .table(
    "contact_merges",
    {
      workspaceId: workspaceColumn(),
      id: uuid("id").defaultRandom().notNull(),
      sourcePrincipalId: typeIdColumn("principal")(
        "source_principal_id",
      ).notNull(),
      targetPrincipalId: typeIdColumn("principal")(
        "target_principal_id",
      ).notNull(),
      mergedByPrincipalId: typeIdColumnNullable("principal")(
        "merged_by_principal_id",
      ),
      reason: text("reason"),
      snapshot: jsonb("snapshot").$type<ContactMergeSnapshot>().notNull(),
      reversibleUntil: timestamp("reversible_until", {
        withTimezone: true,
      }).notNull(),
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
      index("contact_merges_ws_source_idx").on(
        table.workspaceId,
        table.sourcePrincipalId,
      ),
      index("contact_merges_ws_target_idx").on(
        table.workspaceId,
        table.targetPrincipalId,
      ),
      foreignKey({
        columns: [table.workspaceId, table.sourcePrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
        name: "contact_merges_source_fk",
      }).onDelete("cascade"),
      foreignKey({
        columns: [table.workspaceId, table.targetPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
        name: "contact_merges_target_fk",
      }).onDelete("cascade"),
      foreignKey({
        columns: [table.workspaceId, table.mergedByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
        name: "contact_merges_merged_by_fk",
      }).onDelete("set null"),
      foreignKey({
        columns: [table.workspaceId, table.undoneByPrincipalId],
        foreignColumns: [principal.workspaceId, principal.id],
        name: "contact_merges_undone_by_fk",
      }).onDelete("set null"),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();

export type ContactIdentityRow = typeof contactIdentities.$inferSelect;
export type ContactMergeRow = typeof contactMerges.$inferSelect;
