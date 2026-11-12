import { and, asc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import { companies } from "../../database/quills/schema/companies";
import { conversations } from "../../database/quills/schema/conversation";
import {
  ticketConversations,
  tickets,
} from "../../database/quills/schema/tickets";
import { companyAttributeDefinitions } from "../../database/quills/schema/company-attributes";
import { defineQuillsRoute } from "../framework/define-route";
import {
  attributeList,
  attributeListSchema,
  attributesInput,
  coerceAttributes,
  isCustomer,
  loadCustomer,
  person,
  personColumns,
  toPerson,
  type Db,
} from "./customer";

// Table-qualified: in a one-table select, drizzle writes ${companies.id} as a bare "id", which the
// subquery would bind to m.id.
const memberCount = sql<number>`(select count(*)::int from ${principal} m where m.company_id = ${companies}.id and m.kaneo_user_id is null and m.test_owner_principal_id is null)`;
const companyFields = {
  id: companies.id,
  name: companies.name,
  domain: companies.domain,
  externalId: companies.externalId,
  plan: companies.plan,
  mrrCents: companies.mrrCents,
  size: companies.size,
  website: companies.website,
  industry: companies.industry,
  source: companies.source,
  customAttributes: companies.customAttributes,
  memberCount,
  createdAt: companies.createdAt,
  updatedAt: companies.updatedAt,
};
const company = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  externalId: z.string().nullable(),
  plan: z.string().nullable(),
  mrrCents: z.number().nullable(),
  size: z.string().nullable(),
  website: z.string().nullable(),
  industry: z.string().nullable(),
  source: z.string(),
  attributes: attributeListSchema,
  memberCount: z.number(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
type Row = Awaited<ReturnType<typeof loadCompany>>;
const toCompany = ({ customAttributes, ...row }: Row) => ({
  ...row,
  memberCount: Number(row.memberCount),
  attributes: attributeList(customAttributes ?? {}),
});

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const fields = {
  domain: text(255),
  externalId: text(255),
  plan: text(100),
  mrrCents: z.number().int().min(0).max(2147483647).nullable().optional(),
  size: text(100),
  website: text(255),
  industry: text(100),
  attributes: attributesInput.optional(),
};
const companyParams = z.object({
  companyId: flexibleToTypeIdSchema("company"),
});
const principalParams = z.object({
  principalId: flexibleToTypeIdSchema("principal"),
});
const notFound = { 404: "Company not found" };
type CompanyId = typeof companies.$inferSelect.id;

async function loadCompany(db: Db, id: string) {
  const [row] = await db
    .select(companyFields)
    .from(companies)
    .where(eq(companies.id, id as CompanyId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Company not found" });
  return row;
}

/** Domain and external ID are unique per workspace; 409 before the index rejects a write. */
async function assertUnique(
  db: Db,
  values: { domain?: string | null; externalId?: string | null },
  except?: string,
) {
  const checks = [
    values.domain
      ? sql`lower(${companies.domain}) = ${values.domain.toLowerCase()}`
      : undefined,
    values.externalId ? eq(companies.externalId, values.externalId) : undefined,
  ].filter(Boolean);
  if (!checks.length) return;
  const [taken] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        or(...checks),
        except ? ne(companies.id, except as CompanyId) : undefined,
      ),
    )
    .limit(1);
  if (taken)
    throw new HTTPException(409, {
      message: "Domain or external ID already in use",
    });
}

async function customAttributes(
  db: Db,
  current: Record<string, unknown>,
  input: Record<string, string | number | boolean | null> | undefined,
) {
  if (!input) return undefined;
  const change = await coerceAttributes(db, input, companyAttributeDefinitions);
  const next: Record<string, unknown> = { ...current, ...change.set };
  for (const key of change.remove) delete next[key];
  return next;
}

const listCompanies = defineQuillsRoute({
  method: "get",
  path: "/companies",
  operationId: "listQuillsCompanies",
  summary: "List companies",
  action: "read",
  query: z.object({
    search: z.string().trim().max(200).optional(),
    plan: z.string().trim().max(100).optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({
    companies: z.array(company),
    total: z.number(),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of companies",
  handler: async ({ db, query }) => {
    const where = and(
      query.search
        ? or(
            ilike(companies.name, `%${query.search}%`),
            ilike(companies.domain, `%${query.search}%`),
          )
        : undefined,
      query.plan ? eq(companies.plan, query.plan) : undefined,
    );
    const rows = await db
      .select(companyFields)
      .from(companies)
      .where(where)
      .orderBy(asc(companies.name), asc(companies.id))
      .offset(query.offset)
      .limit(query.limit);
    const [count] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(companies)
      .where(where);
    const total = Number(count?.total ?? 0);
    return {
      companies: rows.map(toCompany),
      total,
      nextOffset:
        query.offset + rows.length < total ? query.offset + rows.length : null,
    };
  },
});

const getCompany = defineQuillsRoute({
  method: "get",
  path: "/companies/{companyId}",
  operationId: "getQuillsCompany",
  summary: "Get a company",
  action: "read",
  params: companyParams,
  response: company,
  responseDescription: "The company",
  errors: notFound,
  handler: async ({ db, params }) =>
    toCompany(await loadCompany(db, params.companyId)),
});

const createCompany = defineQuillsRoute({
  method: "post",
  path: "/companies",
  operationId: "createQuillsCompany",
  summary: "Create a company",
  action: "create",
  body: z.object({ name: z.string().trim().min(1).max(200), ...fields }),
  response: company,
  responseDescription: "The new company",
  errors: { 409: "Domain or external ID already in use" },
  event: (_input, result) => ({
    type: "company.created",
    entityType: "company",
    entityId: result.id,
  }),
  handler: async ({ db, body }) => {
    await assertUnique(db, body);
    const [row] = await db
      .insert(companies)
      .values({
        name: body.name,
        domain: body.domain,
        externalId: body.externalId,
        plan: body.plan,
        mrrCents: body.mrrCents,
        size: body.size,
        website: body.website,
        industry: body.industry,
        source: "manual",
        customAttributes: await customAttributes(db, {}, body.attributes),
      })
      .returning({ id: companies.id });
    return toCompany(await loadCompany(db, row!.id));
  },
});

const updateCompany = defineQuillsRoute({
  method: "put",
  path: "/companies/{companyId}",
  operationId: "updateQuillsCompany",
  summary: "Update a company",
  description:
    "Attribute values need a company attribute definition; null removes one.",
  action: "update",
  params: companyParams,
  body: z
    .object({ name: z.string().trim().min(1).max(200).optional(), ...fields })
    .refine((b) => Object.keys(b).length > 0, "Send at least one field"),
  response: company,
  responseDescription: "The updated company",
  errors: { ...notFound, 409: "Domain or external ID already in use" },
  event: ({ params }) => ({
    type: "company.updated",
    entityType: "company",
    entityId: params.companyId,
  }),
  handler: async ({ db, params, body }) => {
    const current = await loadCompany(db, params.companyId);
    await assertUnique(db, body, params.companyId);
    await db
      .update(companies)
      .set({
        name: body.name,
        domain: body.domain,
        externalId: body.externalId,
        plan: body.plan,
        mrrCents: body.mrrCents,
        size: body.size,
        website: body.website,
        industry: body.industry,
        customAttributes: await customAttributes(
          db,
          current.customAttributes ?? {},
          body.attributes,
        ),
      })
      .where(eq(companies.id, params.companyId));
    return toCompany(await loadCompany(db, params.companyId));
  },
});

const deleteCompany = defineQuillsRoute({
  method: "delete",
  path: "/companies/{companyId}",
  operationId: "deleteQuillsCompany",
  summary: "Delete a company",
  description: "People of the company stay; their company is cleared.",
  action: "delete",
  params: companyParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted company",
  errors: notFound,
  event: ({ params }) => ({
    type: "company.deleted",
    entityType: "company",
    entityId: params.companyId,
  }),
  handler: async ({ db, params }) => {
    const rows = await db
      .delete(companies)
      .where(eq(companies.id, params.companyId))
      .returning({ id: companies.id });
    if (!rows.length)
      throw new HTTPException(404, { message: "Company not found" });
    return rows[0]!;
  },
});

const listMembers = defineQuillsRoute({
  method: "get",
  path: "/companies/{companyId}/members",
  operationId: "listQuillsCompanyMembers",
  summary: "List the customers of a company",
  action: "read",
  params: companyParams,
  query: z.object({
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({
    items: z.array(person),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of customers",
  errors: notFound,
  handler: async ({ db, params, query }) => {
    await loadCompany(db, params.companyId);
    const rows = await db
      .select(personColumns)
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(and(isCustomer, eq(principal.companyId, params.companyId)))
      .orderBy(asc(user.name), asc(principal.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    return {
      items: rows.slice(0, query.limit).map(toPerson),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

// Test customers' threads and tickets stay out, as in database/quills/test-data.ts: a ticket is test
// when a test customer requested it or it is linked to a test customer's conversation. The outer
// company is named with its table: a bare column in a select list renders unqualified.
const activityCounts = {
  conversations: sql<number>`(select count(*)::int from ${conversations} c join ${principal} v on v.id = c.visitor_principal_id where v.company_id = ${companies}.id and v.test_owner_principal_id is null)`,
  tickets: sql<number>`(select count(*)::int from ${tickets} t where t.company_id = ${companies}.id and t.deleted_at is null
    and not exists (select 1 from ${principal} r where r.id = t.requester_principal_id and r.test_owner_principal_id is not null)
    and not exists (select 1 from ${ticketConversations} l join ${conversations} lc on lc.id = l.conversation_id join ${principal} lv on lv.id = lc.visitor_principal_id
      where l.ticket_id = t.id and lv.test_owner_principal_id is not null))`,
};

const companyActivity = defineQuillsRoute({
  method: "get",
  path: "/companies/{companyId}/activity",
  operationId: "getQuillsCompanyActivity",
  summary: "Count the conversations and tickets of a company",
  description:
    "Conversations whose visitor belongs to the company, and the company's live tickets. Test customers' conversations and tickets are left out.",
  action: "read",
  params: companyParams,
  response: z.object({ conversations: z.number(), tickets: z.number() }),
  responseDescription: "Activity counts",
  errors: notFound,
  handler: async ({ db, params }) => {
    const [row] = await db
      .select(activityCounts)
      .from(companies)
      .where(eq(companies.id, params.companyId))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Company not found" });
    return row;
  },
});

const getPersonCompany = defineQuillsRoute({
  method: "get",
  path: "/users/{principalId}/company",
  operationId: "getQuillsUserCompany",
  summary: "Get a customer's company",
  action: "read",
  params: principalParams,
  response: z.object({ company: company.nullable() }),
  responseDescription: "The company, or null",
  errors: { 404: "Person not found" },
  handler: async ({ db, params }) => {
    const { companyId } = await loadCustomer(db, params.principalId);
    return {
      company: companyId ? toCompany(await loadCompany(db, companyId)) : null,
    };
  },
});

const setPersonCompany = defineQuillsRoute({
  method: "put",
  path: "/users/{principalId}/company",
  operationId: "setQuillsUserCompany",
  summary: "Attach a customer to a company",
  description:
    "Send `companyId` to attach an existing company, or `name` to attach the company with that name (case-insensitive), created when missing.",
  action: "update",
  params: principalParams,
  body: z
    .object({
      companyId: flexibleToTypeIdSchema("company").optional(),
      name: z.string().trim().min(1).max(200).optional(),
      size: text(100),
      website: text(255),
      industry: text(100),
    })
    .refine(
      (b) => Boolean(b.companyId) !== Boolean(b.name),
      "Send companyId or name",
    ),
  response: company,
  responseDescription: "The customer's company",
  errors: { 404: "Person or company not found" },
  event: ({ params }, result) => ({
    type: "user.company_set",
    entityType: "principal",
    entityId: params.principalId,
    payload: { companyId: result.id },
  }),
  handler: async ({ db, params, body }) => {
    await loadCustomer(db, params.principalId, true);
    let companyId = body.companyId;
    if (companyId) await loadCompany(db, companyId);
    else {
      const [existing] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(sql`lower(${companies.name}) = ${body.name!.toLowerCase()}`)
        .orderBy(asc(companies.createdAt))
        .limit(1);
      companyId =
        existing?.id ??
        (
          await db
            .insert(companies)
            .values({
              name: body.name!,
              size: body.size,
              website: body.website,
              industry: body.industry,
              source: "manual",
            })
            .returning({ id: companies.id })
        )[0]!.id;
    }
    await db
      .update(principal)
      .set({ companyId })
      .where(eq(principal.id, params.principalId));
    return toCompany(await loadCompany(db, companyId));
  },
});

const removePersonCompany = defineQuillsRoute({
  method: "delete",
  path: "/users/{principalId}/company",
  operationId: "removeQuillsUserCompany",
  summary: "Detach a customer from its company",
  action: "update",
  params: principalParams,
  response: z.object({ removed: z.boolean() }),
  responseDescription: "Whether the customer had a company",
  errors: { 404: "Person not found" },
  event: ({ params }) => ({
    type: "user.company_removed",
    entityType: "principal",
    entityId: params.principalId,
  }),
  handler: async ({ db, params }) => {
    const { companyId } = await loadCustomer(db, params.principalId, true);
    await db
      .update(principal)
      .set({ companyId: null })
      .where(eq(principal.id, params.principalId));
    return { removed: Boolean(companyId) };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listCompanies)
  .openapi(...getCompany)
  .openapi(...createCompany)
  .openapi(...updateCompany)
  .openapi(...deleteCompany)
  .openapi(...listMembers)
  .openapi(...companyActivity)
  .openapi(...getPersonCompany)
  .openapi(...setPersonCompany)
  .openapi(...removePersonCompany);
