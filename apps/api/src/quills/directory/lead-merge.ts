import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { toUuid } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { user } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { loadCustomer, type Db } from "./customer";

/**
 * Tables whose principal column moves from the lead to the customer, in order.
 * `unique` lists the other columns of a unique key: a lead row that would collide
 * with a row the customer already has is dropped, and the customer's row wins.
 * Ported from Quackback's REPOINT_STEPS. A reference this list misses fails the
 * final delete (RESTRICT) and rolls the merge back.
 */
const steps: { table: string; column: string; unique?: string[] }[] = [
  { table: "slack_user_links", column: "principal_id" },
  { table: "post_votes", column: "principal_id", unique: ["post_id"] },
  {
    table: "post_comment_reactions",
    column: "principal_id",
    unique: ["comment_id", "emoji"],
  },
  { table: "in_app_notifications", column: "principal_id" },
  { table: "post_comments", column: "principal_id" },
  { table: "posts", column: "principal_id" },
  { table: "email_log", column: "principal_id" },
  { table: "post_edit_history", column: "editor_principal_id" },
  { table: "post_comment_edit_history", column: "editor_principal_id" },
  { table: "post_activity", column: "principal_id" },
  { table: "conversations", column: "visitor_principal_id" },
  { table: "conversation_messages", column: "principal_id" },
  { table: "files", column: "uploaded_by_id" },
  {
    table: "conversation_participants",
    column: "principal_id",
    unique: ["conversation_id"],
  },
  { table: "conversation_summaries", column: "visitor_principal_id" },
  { table: "workflow_runs", column: "subject_principal_id" },
  { table: "workflow_run_events", column: "subject_principal_id" },
  { table: "post_subscriptions", column: "principal_id", unique: ["post_id"] },
  { table: "page_views", column: "principal_id" },
  { table: "visitor_devices", column: "principal_id" },
  { table: "user_tag_assignments", column: "principal_id", unique: ["tag_id"] },
  {
    table: "kb_article_feedback",
    column: "principal_id",
    unique: ["article_id"],
  },
  {
    table: "channel_identities",
    column: "principal_id",
    unique: ["channel", "external_id"],
  },
  { table: "tickets", column: "requester_principal_id" },
  { table: "ticket_summaries", column: "requester_principal_id" },
  {
    table: "ticket_subscriptions",
    column: "principal_id",
    unique: ["ticket_id"],
  },
  { table: "ticket_activity", column: "principal_id" },
  { table: "changelog_subscriptions", column: "principal_id", unique: [] },
  { table: "status_subscriptions", column: "principal_id", unique: [] },
  // RFC 0003. These cascade on a principal delete, so a missed table would lose rows, not fail.
  { table: "feedback_signals", column: "principal_id" },
  {
    table: "survey_responses",
    column: "principal_id",
    unique: ["survey_id"],
  },
  {
    table: "changelog_reactions",
    column: "principal_id",
    unique: ["changelog_entry_id", "emoji"],
  },
  { table: "changelog_reads", column: "principal_id", unique: [] },
];

/** Profile fields on the customer that the lead fills only when the customer has none. */
const fillIfEmpty = [
  "contact_email",
  "company_id",
  "blocked_at",
  "blocked_by_principal_id",
];

/** Moves every activity row of `lead` to `target` (widget/anonymous-merge.ts reuses it). */
export async function repoint(db: Db, lead: string, target: string) {
  const from = toUuid(lead),
    to = toUuid(target);
  for (const { table, column, unique } of steps) {
    const name = sql.raw(`quills."${table}"`),
      col = sql.raw(`"${column}"`);
    if (unique) {
      const same = unique.map((u) => sql.raw(` AND t."${u}" = s."${u}"`));
      const drop = sql`DELETE FROM ${name} s WHERE s.${col} = ${from}::uuid AND EXISTS (SELECT 1 FROM ${name} t WHERE t.${col} = ${to}::uuid${sql.join(same, sql``)})`;
      // A dropped duplicate vote leaves the post's count: each vote row counted once.
      await db.execute(
        table === "post_votes"
          ? sql`WITH dropped AS (${drop} RETURNING s.post_id) UPDATE quills.posts p SET vote_count = greatest(0, p.vote_count - 1) FROM dropped WHERE p.id = dropped.post_id`
          : drop,
      );
    }
    await db.execute(
      sql`UPDATE ${name} SET ${col} = ${to}::uuid WHERE ${col} = ${from}::uuid`,
    );
  }
  // Explicit segment memberships follow the person; dynamic ones are rebuilt by evaluation.
  await db.execute(
    sql`DELETE FROM quills.user_segments s WHERE s.principal_id = ${from}::uuid AND (s.added_by = 'dynamic' OR EXISTS (SELECT 1 FROM quills.user_segments t WHERE t.principal_id = ${to}::uuid AND t.segment_id = s.segment_id))`,
  );
  await db.execute(
    sql`UPDATE quills.user_segments SET principal_id = ${to}::uuid WHERE principal_id = ${from}::uuid`,
  );
  for (const column of fillIfEmpty) {
    const col = sql.raw(`"${column}"`);
    await db.execute(
      sql`UPDATE quills.principal SET ${col} = (SELECT source.${col} FROM quills.principal source WHERE source.id = ${from}::uuid) WHERE id = ${to}::uuid AND ${col} IS NULL`,
    );
  }
}

const mergeLead = defineQuillsRoute({
  method: "post",
  path: "/users/{principalId}/merge",
  operationId: "mergeQuillsLeadIntoUser",
  summary: "Merge a lead into an identified customer",
  description:
    "Moves the lead's activity to the customer and removes the lead, in one transaction.",
  action: "update",
  params: z.object({ principalId: flexibleToTypeIdSchema("principal") }),
  body: z.object({ targetPrincipalId: flexibleToTypeIdSchema("principal") }),
  response: z.object({ principalId: z.string() }),
  responseDescription: "The customer that now holds the lead's activity",
  errors: { 404: "Lead or customer not found" },
  event: ({ params }, result) => ({
    type: "user.lead_merged",
    entityType: "principal",
    entityId: result.principalId,
    payload: { leadPrincipalId: params.principalId },
  }),
  handler: async ({ db, params, body }) => {
    if (params.principalId === body.targetPrincipalId)
      throw new HTTPException(404, {
        message: "A lead cannot be merged into itself",
      });
    const lead = await loadCustomer(db, params.principalId, true);
    const target = await loadCustomer(db, body.targetPrincipalId, true);
    if (lead.type !== "anonymous")
      throw new HTTPException(404, { message: "Lead not found" });
    if (target.type !== "user")
      throw new HTTPException(404, { message: "Customer not found" });
    await repoint(db, lead.principalId, target.principalId);
    // The profile delete cascades to the lead's principal.
    await db.delete(user).where(eq(user.id, lead.userId));
    return { principalId: target.principalId };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...mergeLead,
);
