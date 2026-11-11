import { sql, type SQL } from "drizzle-orm";
import { z } from "../../openapi";
import type { SegmentCondition } from "../../database/quills/schema/segments";
import type { AnyQuillsRoute } from "../framework/define-route";

// Dynamic segment rules: the request shape and the SQL that evaluates them.
// Aliases: p = principal, u = customer_identity, co = companies.

export type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

const attributes = [
  "email",
  "email_verified",
  "created_at_days_ago",
  "post_count",
  "vote_count",
  "comment_count",
  "plan",
  "metadata_key",
  "name",
  "locale",
  "country",
  "principal_type",
  "company_plan",
  "company_mrr",
  "company_size",
  "company_industry",
  "company_attr",
] as const;
const operators = [
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "is_set",
  "is_not_set",
] as const;
const scalar = z.union([z.string().max(200), z.number(), z.boolean()]);

/** `value` holds one comparand; `values` holds the list for `in`. */
export const conditionSchema = z.object({
  attribute: z.enum(attributes),
  operator: z.enum(operators),
  value: scalar.nullable().optional(),
  values: z
    .array(z.union([z.string().max(200), z.number()]))
    .max(100)
    .nullable()
    .optional(),
  metadataKey: z.string().max(64).nullable().optional(),
});
export const rulesSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1).max(20),
});
export const rulesOutput = z.object({
  match: z.string(),
  conditions: z.array(
    z.object({
      attribute: z.string(),
      operator: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
      values: z.array(z.union([z.string(), z.number()])).nullable(),
      metadataKey: z.string().nullable(),
    }),
  ),
});

type Rules = z.output<typeof rulesSchema>;
type Stored = { match: "all" | "any"; conditions: SegmentCondition[] };

/** The stored (Quackback) shape keeps the `in` list in `value`. */
export const toStored = (rules: Rules): Stored => ({
  match: rules.match,
  conditions: rules.conditions.map((c) => ({
    attribute: c.attribute,
    operator: c.operator,
    value: c.operator === "in" ? (c.values ?? []) : (c.value ?? undefined),
    metadataKey: c.metadataKey ?? undefined,
  })),
});

export const fromStored = (rules: Stored | null) =>
  rules && {
    match: rules.match,
    conditions: (rules.conditions ?? []).map((c) => ({
      attribute: String(c.attribute),
      operator: String(c.operator),
      value: Array.isArray(c.value) ? null : (c.value ?? null),
      values: Array.isArray(c.value) ? c.value : null,
      metadataKey: c.metadataKey ?? null,
    })),
  };

const compare: Record<string, string> = {
  eq: "=",
  neq: "!=",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};

function textCondition(
  field: SQL,
  c: SegmentCondition,
  { nullSafeNeq = false, upper = false, lower = false } = {},
): SQL | null {
  const norm = (v: unknown) =>
    upper
      ? String(v).toUpperCase()
      : lower
        ? String(v).toLowerCase()
        : String(v);
  if (c.operator === "is_set") return sql`${field} IS NOT NULL`;
  if (c.operator === "is_not_set") return sql`${field} IS NULL`;
  if (c.operator === "in") {
    const list = Array.isArray(c.value) ? c.value : [];
    return list.length
      ? sql`${field} IN (${sql.join(
          list.map((v) => sql`${norm(v)}`),
          sql`, `,
        )})`
      : null;
  }
  const value = norm(c.value);
  if (c.operator === "contains") return sql`${field} ILIKE ${`%${value}%`}`;
  if (c.operator === "starts_with") return sql`${field} ILIKE ${`${value}%`}`;
  if (c.operator === "ends_with") return sql`${field} ILIKE ${`%${value}`}`;
  const op = compare[c.operator];
  if (!op) return null;
  if (c.operator === "neq" && nullSafeNeq)
    return sql`(${field} IS NULL OR ${field} != ${value})`;
  if (typeof c.value === "number")
    return sql`(${field})::numeric ${sql.raw(op)} ${c.value}`;
  return sql`${field} ${sql.raw(op)} ${value}`;
}

function countCondition(count: SQL, c: SegmentCondition): SQL | null {
  if (c.operator === "is_set") return sql`${count} > 0`;
  if (c.operator === "is_not_set") return sql`${count} = 0`;
  const op = compare[c.operator];
  return op ? sql`${count} ${sql.raw(op)} ${Number(c.value)}` : null;
}

const counts = {
  post_count: sql`(SELECT count(*)::int FROM quills."posts" x WHERE x.principal_id = p.id AND x.deleted_at IS NULL)`,
  vote_count: sql`(SELECT count(*)::int FROM quills."post_votes" x WHERE x.principal_id = p.id)`,
  comment_count: sql`(SELECT count(*)::int FROM quills."post_comments" x WHERE x.principal_id = p.id AND x.deleted_at IS NULL)`,
};

/** One condition as SQL, or null when the stored condition is not supported. */
export function conditionSql(c: SegmentCondition): SQL | null {
  const meta = (key: string | undefined) =>
    key ? sql`(nullif(u.metadata, '')::jsonb ->> ${key})` : null;
  switch (c.attribute) {
    case "email":
      return textCondition(sql`lower(u.email)`, c, { lower: true });
    case "email_verified":
      if (c.operator === "is_set") return sql`u.email_verified = true`;
      if (c.operator === "is_not_set") return sql`u.email_verified = false`;
      return sql`u.email_verified = ${c.value === true || c.value === "true"}`;
    case "created_at_days_ago": {
      const op = compare[c.operator];
      return op
        ? sql`(now() - p.created_at) ${sql.raw(op)} (${Number(c.value)} * interval '1 day')`
        : null;
    }
    case "post_count":
    case "vote_count":
    case "comment_count":
      return countCondition(counts[c.attribute], c);
    case "plan":
      return textCondition(meta("plan")!, c);
    case "metadata_key": {
      const field = meta(c.metadataKey);
      return field && textCondition(field, c);
    }
    case "name":
      if (c.operator === "is_set") return sql`TRUE`;
      if (c.operator === "is_not_set") return sql`FALSE`;
      return textCondition(sql`u.name`, c);
    case "locale":
      return textCondition(sql`u.locale`, c, { nullSafeNeq: true });
    case "country":
      return textCondition(sql`u.country`, c, {
        nullSafeNeq: true,
        upper: true,
      });
    case "principal_type":
      if (c.operator === "is_set") return sql`TRUE`;
      if (c.operator === "is_not_set") return sql`FALSE`;
      return textCondition(sql`p.type`, c);
    case "company_plan":
      return textCondition(sql`co.plan`, c, { nullSafeNeq: true });
    case "company_size":
      return textCondition(sql`co.size`, c, { nullSafeNeq: true });
    case "company_industry":
      return textCondition(sql`co.industry`, c, { nullSafeNeq: true });
    case "company_mrr": {
      if (c.operator === "is_set") return sql`co.mrr_cents IS NOT NULL`;
      if (c.operator === "is_not_set") return sql`co.mrr_cents IS NULL`;
      const op = compare[c.operator];
      return op
        ? sql`(co.mrr_cents / 100.0) ${sql.raw(op)} ${Number(c.value)}`
        : null;
    }
    case "company_attr": {
      const key = c.metadataKey;
      return key
        ? textCondition(sql`(co.custom_attributes ->> ${key})`, c)
        : null;
    }
    default:
      return null;
  }
}

/**
 * Identified customers that match the rules, as `SELECT p.id ...`, or null when no
 * condition is supported. Teammates, leads and test customers never match.
 */
export function matchingSql(rules: Stored | null): SQL | null {
  const parts = (rules?.conditions ?? [])
    .map(conditionSql)
    .filter((part): part is SQL => part !== null);
  if (!parts.length) return null;
  const combined = sql.join(
    parts.map((part) => sql`(${part})`),
    sql.raw(rules!.match === "any" ? " OR " : " AND "),
  );
  return sql`SELECT p.id FROM quills."principal" p
    JOIN quills."customer_identity" u ON u.id = p.user_id
    LEFT JOIN quills."companies" co ON co.id = p.company_id
    WHERE p.role = 'user' AND p.type = 'user' AND p.kaneo_user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM quills."principal" m WHERE m.kaneo_user_id = u.kaneo_user_id)
      AND p.test_owner_principal_id IS NULL
      AND (${combined})`;
}

/** The most dynamic members one evaluation may hold. */
export const MAX_DYNAMIC_MEMBERS = 10000;

/**
 * Rebuilds the dynamic members of one segment. Returns null, and writes nothing,
 * when the rules match more than MAX_DYNAMIC_MEMBERS people.
 */
export async function evaluateSegment(
  db: Db,
  segmentId: string,
  rules: Stored | null,
  segmentUuid: string,
) {
  const match = matchingSql(rules) ?? sql`SELECT NULL::uuid AS id WHERE FALSE`;
  const capped = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM (${match} LIMIT ${MAX_DYNAMIC_MEMBERS + 1}) m`,
  );
  const members = Number(capped.rows[0]?.n ?? 0);
  if (members > MAX_DYNAMIC_MEMBERS) return null;
  const removed = await db.execute(
    sql`DELETE FROM quills."user_segments" WHERE segment_id = ${segmentUuid}::uuid AND added_by = 'dynamic' AND principal_id NOT IN (${match}) RETURNING principal_id`,
  );
  const added = await db.execute(
    sql`INSERT INTO quills."user_segments" (principal_id, segment_id, added_by) SELECT m.id, ${segmentUuid}::uuid, 'dynamic' FROM (${match}) m ON CONFLICT DO NOTHING RETURNING principal_id`,
  );
  return {
    segmentId,
    added: added.rows.length,
    removed: removed.rows.length,
    members,
  };
}
