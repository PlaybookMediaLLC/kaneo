import { asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { companyAttributeDefinitions } from "../../database/quills/schema/company-attributes";
import { userAttributeDefinitions } from "../../database/quills/schema/user-attributes";
import { defineQuillsRoute } from "../framework/define-route";

// User and company attribute definitions share one shape and one set of routes.

const types = ["string", "number", "boolean", "date", "currency"] as const;
const currencies = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "CNY",
  "INR",
  "BRL",
] as const;
const definition = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  type: z.enum(types),
  currencyCode: z.string().nullable(),
  externalKey: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
const editable = {
  label: z.string().trim().min(1).max(128),
  description: z.string().trim().max(512).nullable().optional(),
  type: z.enum(types),
  currencyCode: z.enum(currencies).nullable().optional(),
  externalKey: z.string().trim().max(256).nullable().optional(),
};

function attributeRoutes<K extends "user" | "company">(kind: K) {
  const table =
    kind === "user" ? userAttributeDefinitions : companyAttributeDefinitions;
  const fields = {
    id: table.id,
    key: table.key,
    label: table.label,
    description: table.description,
    type: table.type,
    currencyCode: table.currencyCode,
    externalKey: table.externalKey,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  };
  const Kind = kind === "user" ? "User" : "Company";
  // Literal path types keep the typed client's route tree intact.
  const path = `/${kind}-attributes` as const;
  const params = z.object({
    attributeId: flexibleToTypeIdSchema(
      kind === "user" ? "user_attr" : "company_attr",
    ),
  });
  const notFound = { 404: "Attribute not found" };
  const entityType = `${kind}_attribute` as const;

  const list = defineQuillsRoute({
    method: "get",
    path,
    operationId: `listQuills${Kind}Attributes`,
    summary: `List ${kind} attribute definitions`,
    action: "read",
    response: z.object({ attributes: z.array(definition) }),
    responseDescription: "Attribute definitions, up to 500",
    handler: async ({ db }) => ({
      attributes: await db
        .select(fields)
        .from(table)
        .orderBy(asc(table.label))
        .limit(500),
    }),
  });

  const create = defineQuillsRoute({
    method: "post",
    path,
    operationId: `createQuills${Kind}Attribute`,
    summary: `Create a ${kind} attribute definition`,
    action: "manage_settings",
    body: z.object({
      // Keys starting with "_" are reserved for internal metadata.
      key: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
      ...editable,
    }),
    response: definition,
    responseDescription: "The new definition",
    errors: { 409: "An attribute with that key already exists" },
    event: (_input, result) => ({
      type: `${entityType}.created`,
      entityType,
      entityId: result.id,
      payload: { key: result.key },
    }),
    handler: async ({ db, body }) => {
      const [taken] = await db
        .select({ id: table.id })
        .from(table)
        .where(eq(table.key, body.key))
        .limit(1);
      if (taken)
        throw new HTTPException(409, {
          message: "An attribute with that key already exists",
        });
      const [row] = await db
        .insert(table)
        .values({
          key: body.key,
          label: body.label,
          description: body.description,
          type: body.type,
          currencyCode: body.type === "currency" ? body.currencyCode : null,
          externalKey: body.externalKey,
        })
        .returning(fields);
      return row!;
    },
  });

  const update = defineQuillsRoute({
    method: "put",
    path: `${path}/{attributeId}` as const,
    operationId: `updateQuills${Kind}Attribute`,
    summary: `Update a ${kind} attribute definition`,
    description: "The key cannot change.",
    action: "manage_settings",
    params,
    body: z
      .object(editable)
      .partial()
      .refine((b) => Object.keys(b).length > 0, "Send at least one field"),
    response: definition,
    responseDescription: "The updated definition",
    errors: notFound,
    event: ({ params }) => ({
      type: `${entityType}.updated`,
      entityType,
      entityId: params.attributeId,
    }),
    handler: async ({ db, params, body }) => {
      const [row] = await db
        .update(table)
        .set({
          label: body.label,
          description: body.description,
          type: body.type,
          currencyCode: body.currencyCode,
          externalKey: body.externalKey,
          updatedAt: new Date(),
        })
        .where(eq(table.id, params.attributeId))
        .returning(fields);
      if (!row)
        throw new HTTPException(404, { message: "Attribute not found" });
      return row;
    },
  });

  const remove = defineQuillsRoute({
    method: "delete",
    path: `${path}/{attributeId}` as const,
    operationId: `deleteQuills${Kind}Attribute`,
    summary: `Delete a ${kind} attribute definition`,
    description: "Stored values stay on people and companies.",
    action: "manage_settings",
    params,
    response: z.object({ id: z.string() }),
    responseDescription: "The deleted definition",
    errors: notFound,
    event: ({ params }) => ({
      type: `${entityType}.deleted`,
      entityType,
      entityId: params.attributeId,
    }),
    handler: async ({ db, params }) => {
      const rows = await db
        .delete(table)
        .where(eq(table.id, params.attributeId))
        .returning({ id: table.id });
      if (!rows.length)
        throw new HTTPException(404, { message: "Attribute not found" });
      return rows[0]!;
    },
  });

  return apiRouter<BaseVariables & { workspaceId: string }>()
    .openapi(...list)
    .openapi(...create)
    .openapi(...update)
    .openapi(...remove);
}

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", attributeRoutes("user"))
  .route("/", attributeRoutes("company"));
