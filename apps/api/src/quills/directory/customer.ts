import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { nullableResponseTimestamp, responseTimestamp, z } from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import {
  postComments,
  postVotes,
  posts,
} from "../../database/quills/schema/posts";
import { companyAttributeDefinitions } from "../../database/quills/schema/company-attributes";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import type { AnyQuillsRoute } from "../framework/define-route";

// Shared rules for the people directory. Customers only: never a Kaneo teammate,
// a profile linked to a Kaneo member, a service principal or a test customer.

export type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

/** Rows that are customers of this workspace. Use with `customerFrom`. */
export const isCustomer = and(
  isNull(principal.kaneoUserId),
  isNull(principal.testOwnerPrincipalId),
  // A portal profile links a Kaneo account with no membership (decision D1) and is a customer.
  // A profile whose account has a teammate principal here (a member, now or before) is not.
  sql`not exists (select 1 from ${principal} m where m.kaneo_user_id = ${user.kaneoUserId})`,
  eq(principal.role, "user"),
  inArray(principal.type, ["user", "anonymous"]),
)!;

const notTestAuthor = (author: SQL) =>
  sql`not exists (select 1 from ${principal} t where t.id = ${author} and t.test_owner_principal_id is not null)`;

export const activity = {
  postCount: sql<number>`(select count(*)::int from ${posts} ap where ap.principal_id = ${principal.id} and ap.deleted_at is null)`,
  commentCount: sql<number>`(select count(*)::int from ${postComments} ac join ${posts} ap on ap.id = ac.post_id where ac.principal_id = ${principal.id} and ac.deleted_at is null and ${notTestAuthor(sql`ap.principal_id`)})`,
  voteCount: sql<number>`(select count(*)::int from ${postVotes} av join ${posts} ap on ap.id = av.post_id where av.principal_id = ${principal.id} and ${notTestAuthor(sql`ap.principal_id`)})`,
};

export const personColumns = {
  principalId: principal.id,
  userId: user.id,
  type: principal.type,
  name: user.name,
  email: user.email,
  contactEmail: principal.contactEmail,
  image: user.image,
  emailVerified: user.emailVerified,
  country: user.country,
  locale: user.locale,
  externalId: user.externalId,
  metadata: user.metadata,
  companyId: principal.companyId,
  blockedAt: principal.blockedAt,
  joinedAt: principal.createdAt,
  ...activity,
};

export const attributeValue = z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
]);
export const attributesInput = z
  .record(z.string().min(1).max(64), attributeValue.nullable())
  .refine((value) => Object.keys(value).length <= 50, "At most 50 attributes");

/** Keys starting with "_" are internal; only primitive values are attributes. */
export const attributeList = (values: Record<string, unknown>) =>
  Object.entries(values).flatMap(([key, value]) =>
    !key.startsWith("_") && attributeValue.safeParse(value).success
      ? [{ key, value: value as string | number | boolean }]
      : [],
  );
export const attributeListSchema = z.array(
  z.object({ key: z.string(), value: attributeValue }),
);

export const person = z.object({
  principalId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  contactEmail: z.string().nullable(),
  image: z.string().nullable(),
  emailVerified: z.boolean(),
  isLead: z.boolean(),
  country: z.string().nullable(),
  locale: z.string().nullable(),
  externalId: z.string().nullable(),
  attributes: attributeListSchema,
  companyId: z.string().nullable(),
  blockedAt: nullableResponseTimestamp,
  joinedAt: responseTimestamp,
  postCount: z.number(),
  commentCount: z.number(),
  voteCount: z.number(),
});

/** Lead rows carry a synthetic account email that must never render. */
export const realEmail = (email: string | null) =>
  email && !/@anon\.(quills|quackback)\.io$/i.test(email) ? email : null;

export function parseMetadata(metadata: string | null) {
  try {
    const value: unknown = JSON.parse(metadata || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export type PrincipalId = typeof principal.$inferSelect.id;
type PersonRow = Awaited<ReturnType<typeof loadCustomer>>;
export const toPerson = (row: PersonRow): z.input<typeof person> => ({
  principalId: row.principalId,
  userId: row.userId,
  name: row.name,
  email: realEmail(row.email),
  contactEmail: realEmail(row.contactEmail),
  image: row.image,
  emailVerified: row.emailVerified,
  isLead: row.type === "anonymous",
  country: row.country,
  locale: row.locale,
  externalId: row.externalId,
  attributes: attributeList(parseMetadata(row.metadata)),
  companyId: row.companyId,
  blockedAt: row.blockedAt,
  joinedAt: row.joinedAt,
  postCount: Number(row.postCount),
  commentCount: Number(row.commentCount),
  voteCount: Number(row.voteCount),
});

/** One customer of this workspace, or 404. `lock` holds the principal row. */
export async function loadCustomer(db: Db, principalId: string, lock = false) {
  const query = db
    .select(personColumns)
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(and(eq(principal.id, principalId as PrincipalId), isCustomer))
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new HTTPException(404, { message: "Person not found" });
  return row;
}

type Definitions =
  | typeof userAttributeDefinitions
  | typeof companyAttributeDefinitions;

/** Checks attribute values against the workspace definitions and coerces them. */
export async function coerceAttributes(
  db: Db,
  input: Record<string, string | number | boolean | null>,
  table: Definitions = userAttributeDefinitions,
) {
  const keys = Object.keys(input);
  if (!keys.length) return { set: {}, remove: [] as string[] };
  const definitions = await db
    .select({ key: table.key, type: table.type })
    .from(table)
    .where(inArray(table.key, keys));
  const types = new Map(definitions.map((d) => [d.key, d.type]));
  const set: Record<string, string | number | boolean> = {};
  const remove: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const type = types.get(key);
    if (!type)
      throw new HTTPException(400, {
        message: `No attribute definition for "${key}"`,
      });
    if (value === null) {
      remove.push(key);
      continue;
    }
    const coerced = coerce(value, type);
    if (coerced === undefined)
      throw new HTTPException(400, {
        message: `Attribute "${key}" is not a valid ${type}`,
      });
    set[key] = coerced;
  }
  return { set, remove };
}

function coerce(value: string | number | boolean, type: string) {
  if (type === "string") return String(value);
  if (type === "boolean")
    return typeof value === "boolean"
      ? value
      : value === "true"
        ? true
        : value === "false"
          ? false
          : undefined;
  if (type === "date") {
    const time =
      typeof value === "boolean" ? Number.NaN : new Date(value).getTime();
    return Number.isNaN(time) ? undefined : new Date(time).toISOString();
  }
  const number = typeof value === "boolean" ? Number.NaN : Number(value);
  return value === "" || !Number.isFinite(number) ? undefined : number;
}

/** Stored metadata with `set` merged in and `remove` taken out. Internal keys stay. */
export function mergeMetadata(
  metadata: string | null,
  change: { set: Record<string, unknown>; remove: string[] },
) {
  const merged: Record<string, unknown> = {
    ...parseMetadata(metadata),
    ...change.set,
  };
  for (const key of change.remove) delete merged[key];
  return JSON.stringify(merged);
}
