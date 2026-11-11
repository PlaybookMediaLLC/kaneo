import { sql } from "drizzle-orm";
import {
  check,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { quillsSchema, workspaceColumn, workspacePolicy } from "../tenancy";

/** The TXT record name that must hold `verification_value` for the domain. */
export const verificationRecordName = (domain: string) =>
  `_quills-verification.${domain}`;

/**
 * One custom domain per workspace and kind (portal or help center).
 * A domain serves only after `verified_at` is set by a DNS TXT check of `verification_value`.
 */
export const customDomains = quillsSchema
  .table(
    "custom_domains",
    {
      workspaceId: workspaceColumn(),
      kind: text("kind", { enum: ["portal", "help_center"] }).notNull(),
      /** Lower-case ASCII (punycode), no trailing dot. */
      domain: text("domain").notNull(),
      /** Published by the owner in a TXT record. A new domain gets a new value. */
      verificationValue: text("verification_value").notNull(),
      verifiedAt: timestamp("verified_at", { withTimezone: true }),
      checkedAt: timestamp("checked_at", { withTimezone: true }),
      checkResult: text("check_result", {
        enum: ["verified", "missing", "unanswered"],
      }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.workspaceId, table.kind] }),
      // Global on purpose: one domain belongs to one workspace. Row security does not filter a unique index.
      uniqueIndex("custom_domains_domain_unique").on(table.domain),
      check(
        "custom_domains_kind_check",
        sql`${table.kind} IN ('portal', 'help_center')`,
      ),
      check(
        "custom_domains_domain_normalized_check",
        sql`${table.domain} = lower(${table.domain}) AND right(${table.domain}, 1) <> '.' AND char_length(${table.domain}) BETWEEN 3 AND 253`,
      ),
      workspacePolicy(table.workspaceId),
    ],
  )
  .enableRLS();
