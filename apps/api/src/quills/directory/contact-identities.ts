import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { toUuid } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import {
  CONTACT_IDENTITY_KINDS,
  contactIdentities,
  contactMerges,
  type ContactIdentityKind,
  type ContactMergeSnapshot,
} from "../../database/quills/schema/contact-identities";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { isCustomer, loadCustomer } from "./customer";

// Multi-identity contacts, duplicate review, and 30-day lossless reversible contact merge (#310).
// Merging tombstones the source principal (merged_into_principal_id = target) and snapshots every
// moved row ID and stashed colliding row so Undo within 30 days restores both contacts cleanly.

const REVERSIBLE_DAYS = 30;

const principalParams = z.object({
  principalId: flexibleToTypeIdSchema("principal"),
});

const identityParams = z.object({
  principalId: flexibleToTypeIdSchema("principal"),
  identityId: z.string().uuid(),
});

const mergeParams = z.object({
  mergeId: z.string().uuid(),
});

const identitySchema = z.object({
  id: z.string(),
  principalId: z.string(),
  kind: z.enum(CONTACT_IDENTITY_KINDS),
  value: z.string(),
  verified: z.boolean(),
  source: z.string(),
  createdAt: responseTimestamp,
});

const mergeRecordSchema = z.object({
  id: z.string(),
  sourcePrincipalId: z.string(),
  targetPrincipalId: z.string(),
  mergedByPrincipalId: z.string().nullable(),
  reason: z.string().nullable(),
  reversibleUntil: responseTimestamp,
  undoneAt: nullableResponseTimestamp,
  undoneByPrincipalId: z.string().nullable(),
  createdAt: responseTimestamp,
});

/** Normalizes an identity value by kind, returning null if invalid. */
export function normalizeIdentityValue(
  kind: ContactIdentityKind,
  raw: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 320) return null;
  if (kind === "email") {
    const lower = trimmed.toLowerCase();
    return /^[^\s@<>]{1,64}@[^\s@<>]{1,255}$/.test(lower) ? lower : null;
  }
  if (kind === "phone") {
    const cleaned = trimmed.replace(/[\s().-]+/g, "");
    return /^\+?[0-9]{6,20}$/.test(cleaned) ? cleaned : null;
  }
  return trimmed;
}

/**
 * Tables whose rows are repointed with exact ID tracking for lossless undo.
 * Includes push_devices, onboarding_emails, widget_origin_session, and all
 * customer activity tables.
 */
const TRACKED_REPOINT_TABLES: Array<{
  table: string;
  idCol: string;
  principalCol: string;
  uniqueCols?: string[];
  recountOnDrop?: "post_votes" | "kb_article_feedback";
}> = [
  { table: "conversations", idCol: "id", principalCol: "visitor_principal_id" },
  { table: "conversation_messages", idCol: "id", principalCol: "principal_id" },
  {
    table: "conversation_summaries",
    idCol: "id",
    principalCol: "visitor_principal_id",
  },
  { table: "tickets", idCol: "id", principalCol: "requester_principal_id" },
  {
    table: "ticket_summaries",
    idCol: "id",
    principalCol: "requester_principal_id",
  },
  { table: "ticket_activity", idCol: "id", principalCol: "principal_id" },
  { table: "posts", idCol: "id", principalCol: "principal_id" },
  { table: "post_comments", idCol: "id", principalCol: "principal_id" },
  {
    table: "post_votes",
    idCol: "id",
    principalCol: "principal_id",
    uniqueCols: ["post_id"],
    recountOnDrop: "post_votes",
  },
  { table: "post_activity", idCol: "id", principalCol: "principal_id" },
  {
    table: "post_subscriptions",
    idCol: "id",
    principalCol: "principal_id",
    uniqueCols: ["post_id"],
  },
  { table: "files", idCol: "id", principalCol: "uploaded_by_id" },
  { table: "email_log", idCol: "id", principalCol: "principal_id" },
  { table: "in_app_notifications", idCol: "id", principalCol: "principal_id" },
  { table: "feedback_signals", idCol: "id", principalCol: "principal_id" },
  {
    table: "survey_responses",
    idCol: "id",
    principalCol: "principal_id",
    uniqueCols: ["survey_id"],
  },
  {
    table: "kb_article_feedback",
    idCol: "id",
    principalCol: "principal_id",
    uniqueCols: ["article_id"],
    recountOnDrop: "kb_article_feedback",
  },
  { table: "page_views", idCol: "id", principalCol: "principal_id" },
  {
    table: "visitor_devices",
    idCol: "device_id",
    principalCol: "principal_id",
  },
  { table: "push_devices", idCol: "id", principalCol: "principal_id" },
  { table: "unsubscribe_tokens", idCol: "id", principalCol: "principal_id" },
  { table: "workflow_runs", idCol: "id", principalCol: "subject_principal_id" },
  {
    table: "workflow_run_events",
    idCol: "id",
    principalCol: "subject_principal_id",
  },
];

/** Stashes colliding rows and moves remaining rows, recording moved IDs in snapshot. */
async function reversibleRepoint(
  db: Database,
  sourceId: string,
  targetId: string,
): Promise<ContactMergeSnapshot> {
  const from = toUuid(sourceId);
  const to = toUuid(targetId);
  const movedIds: Record<string, string[]> = {};
  const stashedRows: Record<string, Record<string, unknown>[]> = {};

  for (const step of TRACKED_REPOINT_TABLES) {
    const tbl = sql.raw(`quills."${step.table}"`);
    const idCol = sql.raw(`"${step.idCol}"`);
    const pCol = sql.raw(`"${step.principalCol}"`);

    if (step.uniqueCols) {
      const same = step.uniqueCols.map((u) =>
        sql.raw(` AND t."${u}" = s."${u}"`),
      );
      const collisions = await db.execute(
        sql`SELECT row_to_json(s) AS row FROM ${tbl} s WHERE s.${pCol} = ${from}::uuid AND EXISTS (SELECT 1 FROM ${tbl} t WHERE t.${pCol} = ${to}::uuid${sql.join(same, sql``)})`,
      );
      const stashed = (
        collisions.rows as Array<{ row: Record<string, unknown> }>
      ).map((r) => r.row);
      if (stashed.length) {
        stashedRows[step.table] = stashed;
        const drop = sql`DELETE FROM ${tbl} s WHERE s.${pCol} = ${from}::uuid AND EXISTS (SELECT 1 FROM ${tbl} t WHERE t.${pCol} = ${to}::uuid${sql.join(same, sql``)})`;
        if (step.recountOnDrop === "post_votes") {
          await db.execute(
            sql`WITH dropped AS (${drop} RETURNING s.post_id) UPDATE quills.posts p SET vote_count = greatest(0, p.vote_count - 1) FROM dropped WHERE p.id = dropped.post_id`,
          );
        } else if (step.recountOnDrop === "kb_article_feedback") {
          await db.execute(
            sql`WITH dropped AS (${drop} RETURNING s.article_id, s.helpful) UPDATE quills.kb_articles a SET helpful_count = greatest(0, a.helpful_count - d.helpful::int), not_helpful_count = greatest(0, a.not_helpful_count - (NOT d.helpful)::int) FROM dropped d WHERE a.id = d.article_id`,
          );
        } else {
          await db.execute(drop);
        }
      }
    }

    const moved = await db.execute(
      sql`UPDATE ${tbl} SET ${pCol} = ${to}::uuid WHERE ${pCol} = ${from}::uuid RETURNING ${idCol}::text AS id`,
    );
    const ids = (moved.rows as Array<{ id: string }>).map((r) => r.id);
    if (ids.length) movedIds[step.table] = ids;
  }

  // Move existing contact_identities from source to target
  const movedIdentities = await db
    .update(contactIdentities)
    .set({ principalId: targetId as never })
    .where(eq(contactIdentities.principalId, sourceId as never))
    .returning({ id: contactIdentities.id });

  // Snapshot target profile fields before gap-filling from source
  const [targetBeforeRow] = await db
    .select({
      contactEmail: principal.contactEmail,
      companyId: principal.companyId,
      blockedAt: principal.blockedAt,
      blockedByPrincipalId: principal.blockedByPrincipalId,
    })
    .from(principal)
    .where(eq(principal.id, targetId as never))
    .limit(1);

  const [sourceRow] = await db
    .select({
      contactEmail: principal.contactEmail,
      companyId: principal.companyId,
      blockedAt: principal.blockedAt,
      blockedByPrincipalId: principal.blockedByPrincipalId,
      userEmail: user.email,
      emailVerified: user.emailVerified,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, sourceId as never))
    .limit(1);

  // Preserve source's email(s) as secondary identities on target so future inbound emails resolve to target!
  for (const candidateEmail of [
    sourceRow?.userEmail,
    sourceRow?.contactEmail,
  ]) {
    const norm = candidateEmail
      ? normalizeIdentityValue("email", candidateEmail)
      : null;
    if (!norm) continue;
    await db
      .insert(contactIdentities)
      .values({
        principalId: targetId as never,
        kind: "email",
        value: norm,
        verified: Boolean(
          sourceRow?.emailVerified && candidateEmail === sourceRow?.userEmail,
        ),
        source: "merge",
      })
      .onConflictDoNothing();
  }

  // Fill empty target fields from source
  if (targetBeforeRow && sourceRow) {
    await db
      .update(principal)
      .set({
        contactEmail: targetBeforeRow.contactEmail ?? sourceRow.contactEmail,
        companyId: targetBeforeRow.companyId ?? sourceRow.companyId,
        blockedAt: targetBeforeRow.blockedAt ?? sourceRow.blockedAt,
        blockedByPrincipalId:
          targetBeforeRow.blockedByPrincipalId ??
          sourceRow.blockedByPrincipalId,
      })
      .where(eq(principal.id, targetId as never));
  }

  return {
    movedIds,
    stashedRows,
    targetBefore: {
      contactEmail: targetBeforeRow?.contactEmail ?? null,
      companyId: targetBeforeRow?.companyId ?? null,
      blockedAt: targetBeforeRow?.blockedAt?.toISOString() ?? null,
      blockedByPrincipalId: targetBeforeRow?.blockedByPrincipalId ?? null,
    },
    movedIdentityIds: movedIdentities.map((r) => r.id),
  };
}

/** Restores every row moved or stashed by reversibleRepoint. */
async function reverseRepoint(
  db: Database,
  sourceId: string,
  targetId: string,
  snapshot: ContactMergeSnapshot,
) {
  const from = toUuid(sourceId);
  const to = toUuid(targetId);

  for (const step of TRACKED_REPOINT_TABLES) {
    const ids = snapshot.movedIds[step.table];
    if (ids?.length) {
      const tbl = sql.raw(`quills."${step.table}"`);
      const idCol = sql.raw(`"${step.idCol}"`);
      const pCol = sql.raw(`"${step.principalCol}"`);
      const isUuidCol = step.idCol !== "device_id";
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const list = sql.join(
          chunk.map((id) => (isUuidCol ? sql`${id}::uuid` : sql`${id}`)),
          sql`, `,
        );
        await db.execute(
          sql`UPDATE ${tbl} SET ${pCol} = ${from}::uuid WHERE ${idCol} IN (${list}) AND ${pCol} = ${to}::uuid`,
        );
      }
    }
    const stashed = snapshot.stashedRows[step.table];
    if (stashed?.length && step.table === "post_votes") {
      for (const row of stashed) {
        const res = await db.execute<{ id: string }>(
          sql`INSERT INTO quills.post_votes (
                workspace_id, id, post_id, principal_id,
                source_type, source_external_url, added_by_principal_id,
                source_signal_id, importance, created_at, updated_at
              )
              SELECT
                ${row.workspace_id}, ${row.id}::uuid, ${row.post_id}::uuid, ${from}::uuid,
                coalesce(${row.source_type ?? null}, 'direct'),
                ${row.source_external_url ?? null},
                ${row.added_by_principal_id ?? null}::uuid,
                ${row.source_signal_id ?? null}::uuid,
                ${row.importance ?? null},
                coalesce(${row.created_at}::timestamptz, now()),
                coalesce(${row.updated_at ?? row.created_at}::timestamptz, now())
              WHERE EXISTS (SELECT 1 FROM quills.posts p WHERE p.id = ${row.post_id}::uuid)
              ON CONFLICT DO NOTHING
              RETURNING id`,
        );
        if (res.rows.length > 0) {
          await db.execute(
            sql`UPDATE quills.posts SET vote_count = vote_count + 1 WHERE id = ${row.post_id}::uuid`,
          );
        }
      }
    } else if (stashed?.length && step.table === "post_subscriptions") {
      for (const row of stashed) {
        await db.execute(
          sql`INSERT INTO quills.post_subscriptions (
                workspace_id, id, post_id, principal_id,
                reason, notify_comments, notify_status_changes,
                created_at, updated_at
              )
              SELECT
                ${row.workspace_id}, ${row.id}::uuid, ${row.post_id}::uuid, ${from}::uuid,
                coalesce(${row.reason ?? null}, 'manual'),
                coalesce(${row.notify_comments ?? null}::boolean, true),
                coalesce(${row.notify_status_changes ?? null}::boolean, true),
                coalesce(${row.created_at}::timestamptz, now()),
                coalesce(${row.updated_at ?? row.created_at}::timestamptz, now())
              WHERE EXISTS (SELECT 1 FROM quills.posts p WHERE p.id = ${row.post_id}::uuid)
              ON CONFLICT DO NOTHING`,
        );
      }
    } else if (stashed?.length && step.table === "survey_responses") {
      for (const row of stashed) {
        await db.execute(
          sql`INSERT INTO quills.survey_responses (workspace_id, id, survey_id, principal_id, score, choice, comment, created_at)
              SELECT ${row.workspace_id}, ${row.id}::uuid, ${row.survey_id}::uuid, ${from}::uuid,
                ${row.score ?? null}::int, ${row.choice ?? null}, ${row.comment ?? null}, coalesce(${row.created_at}::timestamptz, now())
              WHERE EXISTS (SELECT 1 FROM quills.surveys s WHERE s.id = ${row.survey_id}::uuid)
              ON CONFLICT DO NOTHING`,
        );
      }
    } else if (stashed?.length && step.table === "kb_article_feedback") {
      for (const row of stashed) {
        const res = await db.execute<{ helpful: boolean }>(
          sql`INSERT INTO quills.kb_article_feedback (workspace_id, id, article_id, principal_id, helpful, reason, created_at)
              SELECT ${row.workspace_id}, ${row.id}::uuid, ${row.article_id}::uuid, ${from}::uuid,
                ${Boolean(row.helpful)}, ${row.reason ?? null}, coalesce(${row.created_at}::timestamptz, now())
              WHERE EXISTS (SELECT 1 FROM quills.kb_articles a WHERE a.id = ${row.article_id}::uuid)
              ON CONFLICT DO NOTHING
              RETURNING helpful`,
        );
        if (res.rows.length > 0) {
          await db.execute(
            res.rows[0]!.helpful
              ? sql`UPDATE quills.kb_articles SET helpful_count = helpful_count + 1 WHERE id = ${row.article_id}::uuid`
              : sql`UPDATE quills.kb_articles SET not_helpful_count = not_helpful_count + 1 WHERE id = ${row.article_id}::uuid`,
          );
        }
      }
    }
  }

  // Remove merge-created alias identities on target that belong to source's primary/contact emails
  const [sourceEmails] = await db
    .select({
      contactEmail: principal.contactEmail,
      userEmail: user.email,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, sourceId as never))
    .limit(1);
  for (const candidate of [
    sourceEmails?.userEmail,
    sourceEmails?.contactEmail,
  ]) {
    const norm = candidate ? normalizeIdentityValue("email", candidate) : null;
    if (!norm) continue;
    await db
      .delete(contactIdentities)
      .where(
        and(
          eq(contactIdentities.principalId, targetId as never),
          eq(contactIdentities.kind, "email"),
          eq(contactIdentities.source, "merge"),
          sql`lower(${contactIdentities.value}) = ${norm}`,
        ),
      );
  }

  // Move original contact_identities back to source in one batched query
  if (snapshot.movedIdentityIds.length) {
    await db
      .update(contactIdentities)
      .set({ principalId: sourceId as never })
      .where(
        and(
          inArray(contactIdentities.id, snapshot.movedIdentityIds),
          eq(contactIdentities.principalId, targetId as never),
        ),
      );
  }

  // Restore target profile fields without ever clearing a block applied after the merge
  await db
    .update(principal)
    .set({
      contactEmail: snapshot.targetBefore.contactEmail,
      companyId: snapshot.targetBefore.companyId as never,
      ...(snapshot.targetBefore.blockedAt
        ? {
            blockedAt: new Date(snapshot.targetBefore.blockedAt),
            blockedByPrincipalId: snapshot.targetBefore
              .blockedByPrincipalId as never,
          }
        : {}),
    })
    .where(eq(principal.id, targetId as never));
}

const listIdentities = defineQuillsRoute({
  method: "get",
  path: "/users/{principalId}/identities",
  operationId: "listQuillsContactIdentities",
  summary: "List all linked identities of a contact",
  action: "read",
  params: principalParams,
  response: z.object({ items: z.array(identitySchema) }),
  responseDescription:
    "Linked emails, external IDs, phones, and channel handles",
  errors: { 404: "Person not found" },
  handler: async ({ db, params }) => {
    await loadCustomer(db, params.principalId);
    const items = await db
      .select({
        id: contactIdentities.id,
        principalId: contactIdentities.principalId,
        kind: contactIdentities.kind,
        value: contactIdentities.value,
        verified: contactIdentities.verified,
        source: contactIdentities.source,
        createdAt: contactIdentities.createdAt,
      })
      .from(contactIdentities)
      .where(eq(contactIdentities.principalId, params.principalId))
      .orderBy(desc(contactIdentities.createdAt));
    return { items };
  },
});

const addIdentity = defineQuillsRoute({
  method: "post",
  path: "/users/{principalId}/identities",
  operationId: "addQuillsContactIdentity",
  summary:
    "Attach a secondary email, external ID, phone, or handle to a contact",
  action: "update",
  params: principalParams,
  body: z.object({
    kind: z.enum(CONTACT_IDENTITY_KINDS),
    value: z.string().trim().min(1).max(320),
    verified: z.boolean().optional(),
  }),
  response: identitySchema,
  responseDescription: "The linked identity",
  errors: {
    400: "Invalid identity value",
    404: "Person not found",
    409: "Identity already belongs to another contact",
  },
  event: (_input, result) => ({
    type: "contact_identity.added",
    entityType: "contact_identity",
    entityId: result.id,
    payload: { principalId: result.principalId, kind: result.kind },
  }),
  handler: async ({ db, params, body }) => {
    await loadCustomer(db, params.principalId);
    const [targetPrincipal] = await db
      .select({ mergedInto: principal.mergedIntoPrincipalId })
      .from(principal)
      .where(eq(principal.id, params.principalId))
      .limit(1);
    if (targetPrincipal?.mergedInto) {
      throw new HTTPException(409, {
        message: "Cannot add identities to a merged contact",
      });
    }
    const normalized = normalizeIdentityValue(body.kind, body.value);
    if (!normalized) {
      throw new HTTPException(400, {
        message: `Invalid ${body.kind} identity value`,
      });
    }
    // Check primary emails / external IDs on other live contacts to prevent inbound email hijacking (#310).
    if (body.kind === "email") {
      const [ownerConflict] = await db
        .select({ id: principal.id })
        .from(principal)
        .leftJoin(user, eq(user.id, principal.userId))
        .where(
          and(
            ne(principal.id, params.principalId),
            isNull(principal.mergedIntoPrincipalId),
            sql`(lower(${user.email}) = ${normalized} OR lower(${principal.contactEmail}) = ${normalized})`,
          ),
        )
        .limit(1);
      if (ownerConflict) {
        throw new HTTPException(409, {
          message: "This email already belongs to another contact",
        });
      }
    } else if (body.kind === "external_id") {
      const [extConflict] = await db
        .select({ id: principal.id })
        .from(principal)
        .innerJoin(user, eq(user.id, principal.userId))
        .where(
          and(
            ne(principal.id, params.principalId),
            isNull(principal.mergedIntoPrincipalId),
            sql`lower(${user.externalId}) = ${normalized.toLowerCase()}`,
          ),
        )
        .limit(1);
      if (extConflict) {
        throw new HTTPException(409, {
          message: "This external ID already belongs to another contact",
        });
      }
    }
    const [existing] = await db
      .select({
        id: contactIdentities.id,
        principalId: contactIdentities.principalId,
      })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.kind, body.kind),
          sql`lower(${contactIdentities.value}) = ${normalized.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (existing && existing.principalId !== params.principalId) {
      throw new HTTPException(409, {
        message: "This identity already belongs to another contact",
      });
    }
    if (existing) {
      const [row] = await db
        .select({
          id: contactIdentities.id,
          principalId: contactIdentities.principalId,
          kind: contactIdentities.kind,
          value: contactIdentities.value,
          verified: contactIdentities.verified,
          source: contactIdentities.source,
          createdAt: contactIdentities.createdAt,
        })
        .from(contactIdentities)
        .where(eq(contactIdentities.id, existing.id));
      return row!;
    }
    const [created] = await db
      .insert(contactIdentities)
      .values({
        principalId: params.principalId,
        kind: body.kind,
        value: normalized,
        verified: body.verified ?? false,
        source: "manual",
      })
      .onConflictDoNothing()
      .returning({
        id: contactIdentities.id,
        principalId: contactIdentities.principalId,
        kind: contactIdentities.kind,
        value: contactIdentities.value,
        verified: contactIdentities.verified,
        source: contactIdentities.source,
        createdAt: contactIdentities.createdAt,
      });
    if (!created) {
      throw new HTTPException(409, {
        message: "This identity already belongs to another contact",
      });
    }
    return created;
  },
});

const removeIdentity = defineQuillsRoute({
  method: "delete",
  path: "/users/{principalId}/identities/{identityId}",
  operationId: "removeQuillsContactIdentity",
  summary: "Remove a linked identity from a contact",
  action: "update",
  params: identityParams,
  response: z.object({ deleted: z.literal(true), id: z.string() }),
  responseDescription: "The removed identity",
  errors: { 404: "Identity not found" },
  event: ({ params }) => ({
    type: "contact_identity.removed",
    entityType: "contact_identity",
    entityId: params.identityId,
    payload: { principalId: params.principalId },
  }),
  handler: async ({ db, params }) => {
    const [removed] = await db
      .delete(contactIdentities)
      .where(
        and(
          eq(contactIdentities.id, params.identityId),
          eq(contactIdentities.principalId, params.principalId),
        ),
      )
      .returning({ id: contactIdentities.id });
    if (!removed)
      throw new HTTPException(404, { message: "Identity not found" });
    return { deleted: true as const, id: removed.id };
  },
});

const listDuplicates = defineQuillsRoute({
  method: "get",
  path: "/users/duplicates",
  operationId: "listQuillsDuplicateContacts",
  summary: "Detect likely duplicate contacts in the workspace",
  action: "read",
  response: z.object({
    items: z.array(
      z.object({
        reason: z.enum(["email_match", "name_and_company_match", "name_match"]),
        confidence: z.enum(["high", "medium"]),
        primaryPrincipalId: z.string(),
        duplicatePrincipalId: z.string(),
        primaryName: z.string(),
        duplicateName: z.string(),
        primaryEmail: z.string().nullable(),
        duplicateEmail: z.string().nullable(),
      }),
    ),
  }),
  responseDescription: "Candidate duplicate contact pairs",
  handler: async ({ db }) => {
    const rows = await db
      .select({
        id: principal.id,
        type: principal.type,
        displayName: principal.displayName,
        contactEmail: principal.contactEmail,
        companyId: principal.companyId,
        userName: user.name,
        userEmail: user.email,
        createdAt: principal.createdAt,
      })
      .from(principal)
      .leftJoin(user, eq(user.id, principal.userId))
      .where(and(isCustomer, isNull(principal.mergedIntoPrincipalId)))
      .limit(500);

    const byEmail = new Map<string, typeof rows>();
    const byName = new Map<string, typeof rows>();
    for (const r of rows) {
      const em = (r.userEmail ?? r.contactEmail)?.trim().toLowerCase();
      if (em) {
        const list = byEmail.get(em) ?? [];
        list.push(r);
        byEmail.set(em, list);
      }
      const nm = (r.userName ?? r.displayName ?? "").trim().toLowerCase();
      if (nm && nm !== "anonymous") {
        const list = byName.get(nm) ?? [];
        list.push(r);
        byName.set(nm, list);
      }
    }

    const seenPairs = new Set<string>();
    const items: Array<{
      reason: "email_match" | "name_and_company_match" | "name_match";
      confidence: "high" | "medium";
      primaryPrincipalId: string;
      duplicatePrincipalId: string;
      primaryName: string;
      duplicateName: string;
      primaryEmail: string | null;
      duplicateEmail: string | null;
    }> = [];

    const pushPair = (
      a: (typeof rows)[number],
      b: (typeof rows)[number],
      reason: "email_match" | "name_and_company_match" | "name_match",
      confidence: "high" | "medium",
    ) => {
      const key = [a.id, b.id].sort().join(":");
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      // Prefer identified 'user' over 'anonymous' as primary
      const [primary, dup] =
        a.type === "anonymous" && b.type !== "anonymous" ? [b, a] : [a, b];
      items.push({
        reason,
        confidence,
        primaryPrincipalId: primary.id,
        duplicatePrincipalId: dup.id,
        primaryName: primary.userName ?? primary.displayName ?? "Anonymous",
        duplicateName: dup.userName ?? dup.displayName ?? "Anonymous",
        primaryEmail: primary.userEmail ?? primary.contactEmail ?? null,
        duplicateEmail: dup.userEmail ?? dup.contactEmail ?? null,
      });
    };

    for (const group of byEmail.values()) {
      for (let i = 1; i < group.length; i++) {
        pushPair(group[0]!, group[i]!, "email_match", "high");
      }
    }
    for (const group of byName.values()) {
      for (let i = 1; i < group.length; i++) {
        const sameCo =
          group[0]!.companyId !== null &&
          group[0]!.companyId === group[i]!.companyId;
        pushPair(
          group[0]!,
          group[i]!,
          sameCo ? "name_and_company_match" : "name_match",
          sameCo ? "high" : "medium",
        );
      }
    }

    return { items: items.slice(0, 100) };
  },
});

const mergeContacts = defineQuillsRoute({
  method: "post",
  path: "/users/merge",
  operationId: "mergeQuillsContacts",
  summary:
    "Merge one or more contacts into a surviving contact (30-day reversible)",
  description:
    "Re-points all conversations, tickets, feedback, votes, push devices, and identities to targetPrincipalId, tombstones each source for 30 days, and records a lossless snapshot for undo.",
  action: "update",
  body: z.object({
    sourcePrincipalIds: z
      .array(flexibleToTypeIdSchema("principal"))
      .min(1)
      .max(20),
    targetPrincipalId: flexibleToTypeIdSchema("principal"),
    reason: z.string().trim().max(500).optional(),
  }),
  response: z.object({
    merges: z.array(mergeRecordSchema),
  }),
  responseDescription: "Created reversible contact merge records",
  errors: {
    400: "Cannot merge a contact into itself",
    404: "Contact not found",
    409: "A source or target contact is already merged",
  },
  event: ({ body }, result) => ({
    type: "user.merged",
    entityType: "contact_merge",
    entityId: result.merges[0]!.id,
    payload: {
      targetPrincipalId: body.targetPrincipalId,
      count: String(result.merges.length),
    },
  }),
  handler: async ({ db, actor, body }) => {
    const uniqueSources = Array.from(new Set(body.sourcePrincipalIds));
    if (uniqueSources.includes(body.targetPrincipalId)) {
      throw new HTTPException(400, {
        message: "Cannot merge a contact into itself",
      });
    }
    const allIds = [body.targetPrincipalId, ...uniqueSources].sort();
    const locked = await db
      .select({
        id: principal.id,
        mergedInto: principal.mergedIntoPrincipalId,
      })
      .from(principal)
      .where(inArray(principal.id, allIds as never[]))
      .orderBy(principal.id)
      .for("update");
    const lockedById = new Map(locked.map((r) => [r.id, r]));

    await loadCustomer(db, body.targetPrincipalId);
    if (lockedById.get(body.targetPrincipalId)?.mergedInto) {
      throw new HTTPException(409, {
        message: "Target contact has already been merged into another contact",
      });
    }

    const merges = [];
    const now = new Date();
    const reversibleUntil = new Date(
      now.getTime() + REVERSIBLE_DAYS * 24 * 60 * 60 * 1000,
    );

    for (const sourceId of uniqueSources) {
      await loadCustomer(db, sourceId);
      if (lockedById.get(sourceId)?.mergedInto) {
        throw new HTTPException(409, {
          message: `Contact ${sourceId} is already merged`,
        });
      }
      const snapshot = await reversibleRepoint(
        db,
        sourceId,
        body.targetPrincipalId,
      );
      await db
        .update(principal)
        .set({
          mergedIntoPrincipalId: body.targetPrincipalId,
          mergedAt: now,
        })
        .where(eq(principal.id, sourceId));
      const [record] = await db
        .insert(contactMerges)
        .values({
          sourcePrincipalId: sourceId,
          targetPrincipalId: body.targetPrincipalId,
          mergedByPrincipalId: actor.principalId,
          reason: body.reason ?? null,
          snapshot,
          reversibleUntil,
        })
        .returning({
          id: contactMerges.id,
          sourcePrincipalId: contactMerges.sourcePrincipalId,
          targetPrincipalId: contactMerges.targetPrincipalId,
          mergedByPrincipalId: contactMerges.mergedByPrincipalId,
          reason: contactMerges.reason,
          reversibleUntil: contactMerges.reversibleUntil,
          undoneAt: contactMerges.undoneAt,
          undoneByPrincipalId: contactMerges.undoneByPrincipalId,
          createdAt: contactMerges.createdAt,
        });
      merges.push(record!);
    }

    return { merges };
  },
});

const listMerges = defineQuillsRoute({
  method: "get",
  path: "/users/merges",
  operationId: "listQuillsContactMerges",
  summary: "List recent contact merges",
  action: "read",
  response: z.object({ items: z.array(mergeRecordSchema) }),
  responseDescription: "Recent contact merge records",
  handler: async ({ db }) => {
    const items = await db
      .select({
        id: contactMerges.id,
        sourcePrincipalId: contactMerges.sourcePrincipalId,
        targetPrincipalId: contactMerges.targetPrincipalId,
        mergedByPrincipalId: contactMerges.mergedByPrincipalId,
        reason: contactMerges.reason,
        reversibleUntil: contactMerges.reversibleUntil,
        undoneAt: contactMerges.undoneAt,
        undoneByPrincipalId: contactMerges.undoneByPrincipalId,
        createdAt: contactMerges.createdAt,
      })
      .from(contactMerges)
      .orderBy(desc(contactMerges.createdAt))
      .limit(100);
    return { items };
  },
});

const undoMerge = defineQuillsRoute({
  method: "post",
  path: "/users/merges/{mergeId}/undo",
  operationId: "undoQuillsContactMerge",
  summary: "Undo a contact merge within its 30-day reversibility window",
  action: "update",
  params: mergeParams,
  response: mergeRecordSchema,
  responseDescription: "The undone contact merge record",
  errors: {
    404: "Merge record not found",
    409: "Merge was already undone or past its 30-day undo window",
  },
  event: ({ params }, result) => ({
    type: "user.merge_undone",
    entityType: "contact_merge",
    entityId: params.mergeId,
    payload: {
      sourcePrincipalId: result.sourcePrincipalId,
      targetPrincipalId: result.targetPrincipalId,
    },
  }),
  handler: async ({ db, actor, params }) => {
    const [row] = await db
      .select()
      .from(contactMerges)
      .where(eq(contactMerges.id, params.mergeId))
      .for("update");
    if (!row) {
      throw new HTTPException(404, { message: "Merge record not found" });
    }
    if (row.undoneAt) {
      throw new HTTPException(409, {
        message: "This contact merge has already been undone",
      });
    }
    if (row.reversibleUntil <= new Date()) {
      throw new HTTPException(409, {
        message: "The 30-day undo window for this merge has expired",
      });
    }
    const lockedIds = [row.sourcePrincipalId, row.targetPrincipalId].sort();
    const lockedPrincipals = await db
      .select({
        id: principal.id,
        mergedInto: principal.mergedIntoPrincipalId,
      })
      .from(principal)
      .where(inArray(principal.id, lockedIds as never[]))
      .orderBy(principal.id)
      .for("update");
    const targetP = lockedPrincipals.find(
      (p) => p.id === row.targetPrincipalId,
    );
    const sourceP = lockedPrincipals.find(
      (p) => p.id === row.sourcePrincipalId,
    );
    if (targetP?.mergedInto) {
      throw new HTTPException(409, {
        message: "Undo the later merge on the target contact first",
      });
    }
    if (
      sourceP &&
      sourceP.mergedInto &&
      sourceP.mergedInto !== row.targetPrincipalId
    ) {
      throw new HTTPException(409, {
        message: "Source contact is now merged into a different target",
      });
    }
    await db
      .update(principal)
      .set({ mergedIntoPrincipalId: null, mergedAt: null })
      .where(eq(principal.id, row.sourcePrincipalId));
    await reverseRepoint(
      db,
      row.sourcePrincipalId,
      row.targetPrincipalId,
      row.snapshot,
    );
    const [updated] = await db
      .update(contactMerges)
      .set({
        undoneAt: new Date(),
        undoneByPrincipalId: actor.principalId,
      })
      .where(eq(contactMerges.id, row.id))
      .returning({
        id: contactMerges.id,
        sourcePrincipalId: contactMerges.sourcePrincipalId,
        targetPrincipalId: contactMerges.targetPrincipalId,
        mergedByPrincipalId: contactMerges.mergedByPrincipalId,
        reason: contactMerges.reason,
        reversibleUntil: contactMerges.reversibleUntil,
        undoneAt: contactMerges.undoneAt,
        undoneByPrincipalId: contactMerges.undoneByPrincipalId,
        createdAt: contactMerges.createdAt,
      });
    return updated!;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  // Static paths first so /users/duplicates and /users/merges never parse as principalId
  .openapi(...listDuplicates)
  .openapi(...mergeContacts)
  .openapi(...listMerges)
  .openapi(...undoMerge)
  .openapi(...listIdentities)
  .openapi(...addIdentity)
  .openapi(...removeIdentity);
