/**
 * System-data seed — idempotent reconcile of the reference data every workspace
 * needs to function: default post statuses, default ticket statuses, and default
 * AI customer-agent decline topics.
 *
 * #306: Legacy Quills RBAC tables (`roles`, `permissions`, `role_permissions`,
 * `principal_role_assignments`) are retired from seeding; Kaneo's `public.workspace_user`,
 * `public.workspace_role`, and `@kaneo/permissions` are the sole authorization model.
 * The tables remain in the schema for expand-then-contract rollback safety.
 */
import { DEFAULT_DECLINE_TOPICS } from "@quills/ai/customer-agent";
import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { agentDeclineTopics } from "./schema/agent-guardrails";
import { postStatuses, DEFAULT_STATUSES } from "./schema/statuses";
import { ticketStatuses, DEFAULT_TICKET_STATUSES } from "./schema/tickets";

export const CATALOGUE_VERSION = 3;

export async function seedSystemData(db: Database): Promise<void> {
  const scope = (
    await db.execute<{ workspaceId: string | null }>(
      sql`SELECT nullif(current_setting('quills.workspace_id', true), '') AS "workspaceId"`,
    )
  ).rows[0]?.workspaceId;
  if (!scope)
    throw new Error("Quills seeding requires a workspace transaction");
  // Startup reconciliation and lazy initialization share the same workspace lock.
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(48204, hashtext(${scope}))`,
  );

  // 1. Default post statuses — the post service needs an `open` default to
  //    create the very first post. Seed only when the table is empty.
  const existingStatus = await db
    .select({ id: postStatuses.id })
    .from(postStatuses)
    .limit(1);
  if (existingStatus.length === 0) {
    await db.insert(postStatuses).values(DEFAULT_STATUSES);
  }

  // 2. Default ticket statuses — the ticket service needs a default 'New' status
  //    to create the first ticket. Seed only when the table is empty.
  const existingTicketStatus = await db
    .select({ id: ticketStatuses.id })
    .from(ticketStatuses)
    .limit(1);
  if (existingTicketStatus.length === 0) {
    await db.insert(ticketStatuses).values(DEFAULT_TICKET_STATUSES);
  }

  // 3. Default customer-agent decline topics (#299): pricing, refunds, policies, contract_terms.
  //    onConflictDoNothing preserves any workspace edits, policy changes, or disabled state.
  await db
    .insert(agentDeclineTopics)
    .values(
      DEFAULT_DECLINE_TOPICS.map((topic) => ({
        slug: topic.slug,
        label: topic.label,
        policy: topic.policy,
        examples: [...topic.examples],
        enabled: topic.enabled,
        isDefault: true,
      })),
    )
    .onConflictDoNothing();
}
