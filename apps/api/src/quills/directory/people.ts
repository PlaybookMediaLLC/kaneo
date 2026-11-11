import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import { conversationMessages } from "../../database/quills/schema/conversation";
import {
  postCommentReactions,
  postComments,
  postVotes,
  posts,
} from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import {
  userTagAssignments,
  userTags,
} from "../../database/quills/schema/user-tags";
import { defineQuillsRoute } from "../framework/define-route";
import {
  activity,
  attributesInput,
  coerceAttributes,
  isCustomer,
  loadCustomer,
  mergeMetadata,
  person,
  personColumns,
  toPerson,
  type Db,
} from "./customer";

const principalParams = z.object({
  principalId: flexibleToTypeIdSchema("principal"),
});
const email = z.string().trim().toLowerCase().email().max(254);
const notFound = { 404: "Person not found" };
const nonEmpty = (value: object) => Object.keys(value).length > 0;

/** A lead is an engaged anonymous visitor: it wrote, voted, reacted or left a contact email. */
const leadEngaged = sql`(
  ${principal.contactEmail} is not null
  or exists (select 1 from ${conversationMessages} m where m.principal_id = ${principal.id} and m.workspace_thread_key is null)
  or exists (select 1 from ${posts} p where p.principal_id = ${principal.id})
  or exists (select 1 from ${postVotes} v where v.principal_id = ${principal.id})
  or exists (select 1 from ${postComments} c where c.principal_id = ${principal.id})
  or exists (select 1 from ${postCommentReactions} r where r.principal_id = ${principal.id})
)`;

const byEmail = (address: string) =>
  sql`lower(${user.email}) = ${address.toLowerCase()}`;

async function emailTaken(db: Db, address: string, exceptUserId?: string) {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        byEmail(address),
        exceptUserId
          ? ne(user.id, exceptUserId as typeof user.$inferSelect.id)
          : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function personResult(db: Db, principalId: string) {
  return toPerson(await loadCustomer(db, principalId));
}

const listUsers = defineQuillsRoute({
  method: "get",
  path: "/users",
  operationId: "listQuillsUsers",
  summary: "List customers and leads",
  description:
    "Customers only. Teammates, test customers and service principals are never listed.",
  action: "read",
  query: z.object({
    search: z.string().trim().max(200).optional(),
    lifecycle: z.enum(["users", "leads"]).default("users"),
    verified: z.enum(["true", "false"]).optional(),
    segmentId: flexibleToTypeIdSchema("segment").optional(),
    tagId: flexibleToTypeIdSchema("user_tag").optional(),
    sort: z.enum(["newest", "oldest", "name", "most_active"]).default("newest"),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  response: z.object({
    items: z.array(person),
    total: z.number(),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of people",
  errors: { 404: "Segment or tag not found" },
  handler: async ({ db, query }) => {
    if (query.segmentId) {
      const [found] = await db
        .select({ id: segments.id })
        .from(segments)
        .where(eq(segments.id, query.segmentId))
        .limit(1);
      if (!found)
        throw new HTTPException(404, { message: "Segment not found" });
    }
    if (query.tagId) {
      const [found] = await db
        .select({ id: userTags.id })
        .from(userTags)
        .where(eq(userTags.id, query.tagId))
        .limit(1);
      if (!found) throw new HTTPException(404, { message: "Tag not found" });
    }
    const leads = query.lifecycle === "leads";
    const where = and(
      isCustomer,
      eq(principal.type, leads ? "anonymous" : "user"),
      leads ? leadEngaged : undefined,
      query.search
        ? or(
            ilike(user.name, `%${query.search}%`),
            ilike(user.email, `%${query.search}%`),
            ilike(principal.contactEmail, `%${query.search}%`),
          )
        : undefined,
      query.verified
        ? eq(user.emailVerified, query.verified === "true")
        : undefined,
      query.segmentId
        ? inArray(
            principal.id,
            db
              .select({ id: userSegments.principalId })
              .from(userSegments)
              .where(eq(userSegments.segmentId, query.segmentId)),
          )
        : undefined,
      query.tagId
        ? inArray(
            principal.id,
            db
              .select({ id: userTagAssignments.principalId })
              .from(userTagAssignments)
              .where(eq(userTagAssignments.tagId, query.tagId)),
          )
        : undefined,
    );
    const order = {
      newest: [desc(principal.createdAt), desc(principal.id)],
      oldest: [asc(principal.createdAt), asc(principal.id)],
      name: [asc(user.name), asc(principal.id)],
      most_active: [
        desc(
          sql`${activity.postCount} + ${activity.commentCount} + ${activity.voteCount}`,
        ),
        desc(principal.id),
      ],
    }[query.sort];
    const rows = await db
      .select(personColumns)
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(where)
      .orderBy(...order)
      .offset(query.offset)
      .limit(query.limit);
    const [count] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(where);
    const total = Number(count?.total ?? 0);
    return {
      items: rows.map(toPerson),
      total,
      nextOffset:
        query.offset + rows.length < total ? query.offset + rows.length : null,
    };
  },
});

const findByEmail = defineQuillsRoute({
  method: "get",
  path: "/users/by-email",
  operationId: "findQuillsUsersByEmail",
  summary: "Find the customer and the leads that use an email address",
  action: "read",
  query: z.object({ email }),
  response: z.object({
    user: person.nullable(),
    leads: z.array(person),
  }),
  responseDescription: "The identified customer and up to 20 leads",
  handler: async ({ db, query }) => {
    const rows = await db
      .select(personColumns)
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          isCustomer,
          or(
            and(eq(principal.type, "user"), byEmail(query.email)),
            and(
              eq(principal.type, "anonymous"),
              sql`lower(${principal.contactEmail}) = ${query.email}`,
            ),
          ),
        ),
      )
      .orderBy(asc(principal.createdAt))
      .limit(21);
    const found = rows.find((row) => row.type === "user");
    return {
      user: found ? toPerson(found) : null,
      leads: rows
        .filter((row) => row.type === "anonymous")
        .slice(0, 20)
        .map(toPerson),
    };
  },
});

const createUser = defineQuillsRoute({
  method: "post",
  path: "/users",
  operationId: "createQuillsUser",
  summary: "Create a customer",
  action: "create",
  body: z.object({
    name: z.string().trim().min(1).max(200),
    email: email.optional(),
    emailVerified: z.boolean().default(false),
  }),
  response: person,
  responseDescription: "The new customer",
  errors: { 409: "Email already in use" },
  event: (_input, result) => ({
    type: "user.created",
    entityType: "principal",
    entityId: result.principalId,
    payload: { emailVerified: String(result.emailVerified) },
  }),
  handler: async ({ db, body }) => {
    if (body.email && (await emailTaken(db, body.email)))
      throw new HTTPException(409, { message: "Email already in use" });
    const [identity] = await db
      .insert(user)
      .values({
        name: body.name,
        email: body.email ?? null,
        emailVerified: Boolean(body.email) && body.emailVerified,
      })
      .returning({ id: user.id });
    const [row] = await db
      .insert(principal)
      .values({
        userId: identity!.id,
        role: "user",
        type: "user",
        displayName: body.name,
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    return personResult(db, row!.id);
  },
});

const identifyUser = defineQuillsRoute({
  method: "post",
  path: "/users/identify",
  operationId: "identifyQuillsUser",
  summary: "Create or update a customer by external ID or email",
  action: "update",
  body: z.object({
    email,
    name: z.string().trim().min(1).max(200).optional(),
    image: z.string().url().max(2048).optional(),
    emailVerified: z.boolean().optional(),
    externalId: z.string().trim().min(1).max(255).optional(),
    attributes: attributesInput.optional(),
  }),
  response: person.extend({ created: z.boolean() }),
  responseDescription: "The identified customer",
  errors: { 409: "The email or external ID belongs to a teammate" },
  event: (_input, result) => ({
    type: "user.identified",
    entityType: "principal",
    entityId: result.principalId,
    payload: { created: String(result.created) },
  }),
  handler: async ({ db, body }) => {
    const attributes = await coerceAttributes(db, body.attributes ?? {});
    const [match] = await db
      .select({
        id: user.id,
        kaneoUserId: user.kaneoUserId,
        metadata: user.metadata,
      })
      .from(user)
      .where(
        body.externalId
          ? or(eq(user.externalId, body.externalId), byEmail(body.email))
          : byEmail(body.email),
      )
      // An external ID match wins over an email match.
      .orderBy(
        body.externalId
          ? sql`(${user.externalId} = ${body.externalId}) desc`
          : asc(user.createdAt),
      )
      .limit(1)
      .for("update");
    if (match?.kaneoUserId)
      throw new HTTPException(409, {
        message: "The email or external ID belongs to a teammate",
      });
    if (
      match &&
      body.externalId &&
      (await emailTaken(db, body.email, match.id))
    )
      throw new HTTPException(409, { message: "Email already in use" });
    const fields = {
      email: body.email,
      name: body.name,
      image: body.image,
      emailVerified: body.emailVerified,
      externalId: body.externalId,
      metadata: mergeMetadata(match?.metadata ?? null, attributes),
    };
    const [identity] = match
      ? await db
          .update(user)
          .set(fields)
          .where(eq(user.id, match.id))
          .returning({ id: user.id, name: user.name, image: user.image })
      : await db
          .insert(user)
          .values({
            ...fields,
            name: body.name ?? body.email.split("@")[0]!,
            emailVerified: body.emailVerified ?? false,
          })
          .returning({ id: user.id, name: user.name, image: user.image });
    const [existing] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.userId, identity!.id))
      .limit(1);
    const principalId = existing
      ? existing.id
      : (
          await db
            .insert(principal)
            .values({
              userId: identity!.id,
              role: "user",
              type: "user",
              displayName: identity!.name,
              avatarUrl: identity!.image,
              createdAt: new Date(),
            })
            .returning({ id: principal.id })
        )[0]!.id;
    if (existing)
      await db
        .update(principal)
        .set({ displayName: identity!.name, avatarUrl: identity!.image })
        .where(eq(principal.id, principalId));
    return {
      ...(await personResult(db, principalId)),
      created: !existing,
    };
  },
});

const getUser = defineQuillsRoute({
  method: "get",
  path: "/users/{principalId}",
  operationId: "getQuillsUser",
  summary: "Get a customer with segments and tags",
  action: "read",
  params: principalParams,
  response: person.extend({
    segments: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        type: z.string(),
      }),
    ),
    tags: z.array(
      z.object({ id: z.string(), name: z.string(), color: z.string() }),
    ),
  }),
  responseDescription: "The customer",
  errors: notFound,
  handler: async ({ db, params }) => ({
    ...(await personResult(db, params.principalId)),
    segments: await db
      .select({
        id: segments.id,
        name: segments.name,
        color: segments.color,
        type: segments.type,
      })
      .from(userSegments)
      .innerJoin(segments, eq(segments.id, userSegments.segmentId))
      .where(
        and(
          eq(userSegments.principalId, params.principalId),
          sql`${segments.deletedAt} is null`,
        ),
      )
      .orderBy(asc(segments.name))
      .limit(100),
    tags: await db
      .select({ id: userTags.id, name: userTags.name, color: userTags.color })
      .from(userTagAssignments)
      .innerJoin(userTags, eq(userTags.id, userTagAssignments.tagId))
      .where(
        and(
          eq(userTagAssignments.principalId, params.principalId),
          sql`${userTags.deletedAt} is null`,
        ),
      )
      .orderBy(asc(userTags.name))
      .limit(100),
  }),
});

const updateUser = defineQuillsRoute({
  method: "put",
  path: "/users/{principalId}",
  operationId: "updateQuillsUser",
  summary: "Update a customer's profile and attributes",
  description:
    "For a lead, `email` sets the contact email. Attributes need a user attribute definition; null removes one.",
  action: "update",
  params: principalParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      email: email.nullable().optional(),
      image: z.string().url().max(2048).nullable().optional(),
      emailVerified: z.boolean().optional(),
      externalId: z.string().trim().min(1).max(255).nullable().optional(),
      attributes: attributesInput.optional(),
    })
    .refine(nonEmpty, "Send at least one field"),
  response: person,
  responseDescription: "The updated customer",
  errors: { ...notFound, 409: "Email or external ID already in use" },
  event: ({ params }) => ({
    type: "user.updated",
    entityType: "principal",
    entityId: params.principalId,
  }),
  handler: async ({ db, params, body }) => {
    const current = await loadCustomer(db, params.principalId, true);
    const attributes = await coerceAttributes(db, body.attributes ?? {});
    const lead = current.type === "anonymous";
    if (
      !lead &&
      body.email &&
      (await emailTaken(db, body.email, current.userId))
    )
      throw new HTTPException(409, { message: "Email already in use" });
    if (body.externalId) {
      const [taken] = await db
        .select({ id: user.id })
        .from(user)
        .where(
          and(
            eq(user.externalId, body.externalId),
            ne(user.id, current.userId),
          ),
        )
        .limit(1);
      if (taken)
        throw new HTTPException(409, { message: "External ID already in use" });
    }
    await db
      .update(user)
      .set({
        name: body.name,
        email: lead ? undefined : body.email,
        image: body.image,
        emailVerified: body.emailVerified,
        externalId: body.externalId,
        metadata: body.attributes
          ? mergeMetadata(current.metadata, attributes)
          : undefined,
      })
      .where(eq(user.id, current.userId));
    await db
      .update(principal)
      .set({
        displayName: body.name,
        avatarUrl: body.image,
        contactEmail: lead ? body.email : undefined,
      })
      .where(eq(principal.id, params.principalId));
    return personResult(db, params.principalId);
  },
});

const deleteUser = defineQuillsRoute({
  method: "delete",
  path: "/users/{principalId}",
  operationId: "deleteQuillsUser",
  summary: "Remove a customer",
  description:
    "Removes the principal and keeps the profile for a later sign-in. A person who still authors posts, comments or conversations cannot be removed (409).",
  action: "delete",
  params: principalParams,
  response: z.object({ principalId: z.string() }),
  responseDescription: "The removed customer",
  errors: { ...notFound, 409: "The person still authors content" },
  event: ({ params }) => ({
    type: "user.deleted",
    entityType: "principal",
    entityId: params.principalId,
  }),
  handler: async ({ db, params }) => {
    const current = await loadCustomer(db, params.principalId, true);
    // Widget identity keys are released so a later identify cannot resolve this person.
    await db
      .update(user)
      .set({
        externalId: null,
        metadata: sql`(coalesce(nullif(${user.metadata}, ''), '{}')::jsonb - '_externalUserId')::text`,
      })
      .where(eq(user.id, current.userId));
    try {
      await db.transaction((savepoint) =>
        savepoint.delete(principal).where(eq(principal.id, params.principalId)),
      );
    } catch (error) {
      const code =
        (error as { code?: string; cause?: { code?: string } }).cause?.code ??
        (error as { code?: string }).code;
      // ponytail: authored content blocks removal; Quackback re-attributes it to a deleted-user placeholder.
      if (code === "23503")
        throw new HTTPException(409, {
          message: "The person still authors content",
        });
      throw error;
    }
    return { principalId: params.principalId };
  },
});

const listDuplicates = defineQuillsRoute({
  method: "get",
  path: "/users/{principalId}/duplicates",
  operationId: "listQuillsUserDuplicates",
  summary: "List possible duplicates of a customer",
  description:
    "Other customers with the same email, contact email or name (case-insensitive).",
  action: "read",
  params: principalParams,
  response: z.object({ items: z.array(person) }),
  responseDescription: "Up to 20 possible duplicates",
  errors: notFound,
  handler: async ({ db, params }) => {
    const current = await loadCustomer(db, params.principalId);
    const addresses = [current.email, current.contactEmail]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    const rows = await db
      .select(personColumns)
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          isCustomer,
          ne(principal.id, params.principalId),
          or(
            sql`lower(${user.name}) = ${current.name.toLowerCase()}`,
            addresses.length
              ? or(
                  inArray(sql`lower(${user.email})`, addresses),
                  inArray(sql`lower(${principal.contactEmail})`, addresses),
                )
              : undefined,
          ),
        ),
      )
      .orderBy(asc(principal.createdAt))
      .limit(20);
    return { items: rows.map(toPerson) };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listUsers)
  .openapi(...findByEmail)
  .openapi(...createUser)
  .openapi(...identifyUser)
  .openapi(...getUser)
  .openapi(...updateUser)
  .openapi(...deleteUser)
  .openapi(...listDuplicates);
