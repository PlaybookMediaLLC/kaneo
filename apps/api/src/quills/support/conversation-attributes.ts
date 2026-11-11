import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { conversations } from "../../database/quills/schema/conversation";
import { conversationAttributeDefinitions as definitions } from "../../database/quills/schema/conversation-attributes";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { someField } from "../feedback/schemas";
import {
  attributeEntries,
  attributeEntry,
  conflict,
  uniqueConflict,
  conversationParams,
  errors,
  findConversation,
  notFound,
  notTestConversation,
} from "./conversation-model";

const attributeParams = z.object({
  attributeId: flexibleToTypeIdSchema("conv_attr"),
});
const key = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/\s+/g, "_"))
  .pipe(
    z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/, "Use letters, digits and underscores"),
  );
const fieldTypes = definitions.fieldType.enumValues;
const selectTypes = new Set(["select", "multi_select"]);
const description = z.string().trim().max(512).nullable().optional();
const optionInput = z.object({
  label: z.string().trim().min(1).max(100),
  description,
});
const option = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullish(),
});
const attribute = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  fieldType: z.enum(fieldTypes),
  options: z.array(option).nullable(),
  requiredToClose: z.boolean(),
  sourceHint: z.string().nullable(),
  aiDetect: z.boolean(),
  detectOnClose: z.boolean(),
  archivedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
const fields = {
  id: definitions.id,
  key: definitions.key,
  label: definitions.label,
  description: definitions.description,
  fieldType: definitions.fieldType,
  options: definitions.options,
  requiredToClose: definitions.requiredToClose,
  sourceHint: definitions.sourceHint,
  aiDetect: definitions.aiDetect,
  detectOnClose: definitions.detectOnClose,
  archivedAt: definitions.archivedAt,
  createdAt: definitions.createdAt,
  updatedAt: definitions.updatedAt,
};
const sourceHint = z.enum(["ai", "workflow", "agent"]).nullable().optional();
type AttributeId = TypeId<"conv_attr">;
const toOption = (input: z.output<typeof optionInput>, id?: string) => ({
  // The stable stored value; labels can change.
  id: id ?? `opt_${crypto.randomUUID()}`,
  label: input.label,
  description: input.description || null,
});
const invalid = (message: string) => new HTTPException(400, { message });

/** A definition of this workspace, or 404. `lock` holds the row so parallel option edits cannot drop an option. */
async function findAttribute(db: Database, id: AttributeId, lock = false) {
  const query = db
    .select(fields)
    .from(definitions)
    .where(eq(definitions.id, id));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("Attribute");
  return row;
}

/** AI detection is for select attributes only, as in the source. */
function checkAiDetect(
  fieldType: string,
  flags: { aiDetect?: boolean; detectOnClose?: boolean },
) {
  if ((flags.aiDetect || flags.detectOnClose) && fieldType !== "select")
    throw invalid("AI detection is only available on select attributes");
}

const listAttributes = defineQuillsRoute({
  method: "get",
  path: "/conversation-attributes",
  operationId: "listQuillsConversationAttributes",
  summary: "List conversation attribute definitions",
  description: "By label. Archived definitions only with includeArchived=true.",
  action: "read",
  query: z.object({
    includeArchived: z.enum(["true", "false"]).default("false"),
  }),
  response: z.object({ items: z.array(attribute) }),
  responseDescription: "Attribute definitions",
  errors,
  handler: async ({ db, query }) => ({
    items: await db
      .select(fields)
      .from(definitions)
      .where(
        query.includeArchived === "true"
          ? undefined
          : isNull(definitions.archivedAt),
      )
      .orderBy(asc(definitions.label), asc(definitions.id))
      .limit(500),
  }),
});

const createAttribute = defineQuillsRoute({
  method: "post",
  path: "/conversation-attributes",
  operationId: "createQuillsConversationAttribute",
  summary: "Create a conversation attribute definition",
  description:
    "The key is normalized to snake_case and stays reserved after archiving (409 when taken). Select types need at least one option; other types take none.",
  action: "manage_settings",
  body: z.object({
    key,
    label: z.string().trim().min(1).max(128),
    description,
    fieldType: z.enum(fieldTypes),
    options: z.array(optionInput).max(100).optional(),
    requiredToClose: z.boolean().default(false),
    sourceHint,
    aiDetect: z.boolean().optional(),
    detectOnClose: z.boolean().default(false),
  }),
  response: attribute,
  responseDescription: "Attribute definition",
  errors,
  event: (_input, result) => ({
    type: "conversation_attribute.created",
    entityType: "conversation_attribute",
    entityId: result.id,
    payload: { key: result.key },
  }),
  handler: async ({ db, body }) => {
    const select = selectTypes.has(body.fieldType);
    if (select && !body.options?.length)
      throw invalid("Select attributes need at least one option");
    if (!select && body.options?.length)
      throw invalid("Only select attributes can have options");
    checkAiDetect(body.fieldType, body);
    const [taken] = await db
      .select({ id: definitions.id })
      .from(definitions)
      .where(eq(definitions.key, body.key));
    if (taken) throw conflict("An attribute with that key already exists");
    const [row] = await db
      .insert(definitions)
      .values({
        key: body.key,
        label: body.label,
        description: body.description || null,
        fieldType: body.fieldType,
        options: select ? body.options!.map((o) => toOption(o)) : null,
        requiredToClose: body.requiredToClose,
        sourceHint: body.sourceHint ?? null,
        aiDetect: body.aiDetect ?? body.fieldType === "select",
        detectOnClose: body.detectOnClose,
      })
      .returning(fields)
      .catch(uniqueConflict("An attribute with that key already exists"));
    return row!;
  },
});

const updateAttribute = defineQuillsRoute({
  method: "patch",
  path: "/conversation-attributes/{attributeId}",
  operationId: "updateQuillsConversationAttribute",
  summary: "Update a conversation attribute definition",
  description:
    "Key and field type never change. `options` must keep every existing option ID (rename only); entries without an ID are appended.",
  action: "manage_settings",
  params: attributeParams,
  body: z
    .object({
      label: z.string().trim().min(1).max(128).optional(),
      description,
      options: z
        .array(optionInput.extend({ id: z.string().min(1).max(64).optional() }))
        .max(100)
        .optional(),
      requiredToClose: z.boolean().optional(),
      sourceHint,
      aiDetect: z.boolean().optional(),
      detectOnClose: z.boolean().optional(),
    })
    .refine(someField, {
      message: "Provide at least one field",
    }),
  response: attribute,
  responseDescription: "Attribute definition",
  errors,
  event: ({ params }, result) => ({
    type: "conversation_attribute.updated",
    entityType: "conversation_attribute",
    entityId: params.attributeId,
    payload: { key: result.key },
  }),
  handler: async ({ db, params, body }) => {
    const current = await findAttribute(db, params.attributeId, true);
    checkAiDetect(current.fieldType, body);
    let options = current.options;
    if (body.options !== undefined) {
      if (!selectTypes.has(current.fieldType))
        throw invalid("Only select attributes can have options");
      const existing = new Map((current.options ?? []).map((o) => [o.id, o]));
      const kept = new Set<string>();
      options = body.options.map((o) => {
        if (o.id !== undefined) {
          if (!existing.has(o.id) || kept.has(o.id))
            throw invalid(`Unknown or repeated option ID ${o.id}`);
          kept.add(o.id);
        }
        return toOption(o, o.id);
      });
      if (kept.size !== existing.size)
        throw invalid("Options cannot be removed: stored values may use them");
      if (!options.length)
        throw invalid("Select attributes need at least one option");
    }
    const [row] = await db
      .update(definitions)
      .set({
        label: body.label,
        description:
          body.description === undefined ? undefined : body.description || null,
        options,
        requiredToClose: body.requiredToClose,
        sourceHint: body.sourceHint,
        aiDetect: body.aiDetect,
        detectOnClose: body.detectOnClose,
      })
      .where(eq(definitions.id, current.id))
      .returning(fields);
    return row!;
  },
});

const archiving = <A extends "archive" | "restore">(action: A) =>
  defineQuillsRoute({
    method: "post",
    path: `/conversation-attributes/{attributeId}/${action}`,
    operationId:
      action === "archive"
        ? "archiveQuillsConversationAttribute"
        : "restoreQuillsConversationAttribute",
    summary:
      action === "archive"
        ? "Archive a conversation attribute definition"
        : "Restore an archived conversation attribute definition",
    description:
      "Archived definitions leave pickers; stored values stay readable and the key stays reserved. Returns 409 when the definition is already in that state.",
    action: "manage_settings",
    params: attributeParams,
    response: attribute,
    responseDescription: "Attribute definition",
    errors,
    event: ({ params }, result) => ({
      type:
        action === "archive"
          ? "conversation_attribute.archived"
          : "conversation_attribute.restored",
      entityType: "conversation_attribute",
      entityId: params.attributeId,
      payload: { key: result.key },
    }),
    handler: async ({ db, params }) => {
      const current = await findAttribute(db, params.attributeId, true);
      if ((current.archivedAt !== null) === (action === "archive"))
        throw conflict(
          `The attribute is already ${action === "archive" ? "archived" : "active"}`,
        );
      const [row] = await db
        .update(definitions)
        .set({ archivedAt: action === "archive" ? new Date() : null })
        .where(eq(definitions.id, current.id))
        .returning(fields);
      return row!;
    },
  });

const valueCounts = defineQuillsRoute({
  method: "get",
  path: "/conversation-attributes/{attributeId}/value-counts",
  operationId: "attributeQuillsValueCounts",
  summary: "Count conversations per option of a select attribute",
  description:
    "Conversations created in the last `sinceDays` days (default 30), without test conversations. The last bucket (`optionId` null) counts unset and unknown values. 409 for a non-select attribute.",
  action: "read",
  params: attributeParams,
  query: z.object({ sinceDays: pagingNumber(1, 365, 30) }),
  response: z.object({
    items: z.array(
      z.object({
        optionId: z.string().nullable(),
        label: z.string(),
        count: z.number(),
      }),
    ),
  }),
  responseDescription: "Counts",
  errors,
  handler: async ({ db, params, query }) => {
    const current = await findAttribute(db, params.attributeId);
    if (current.fieldType !== "select")
      throw conflict("Value counts are only available for select attributes");
    const value = sql<
      string | null
    >`(${conversations.customAttributes} -> ${current.key} ->> 'v')`;
    const rows = await db
      .select({ optionId: value, count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(
        and(
          gte(
            conversations.createdAt,
            new Date(Date.now() - query.sinceDays * 86400000),
          ),
          notTestConversation,
        ),
      )
      // By position: the key is a parameter, and two parameters are two expressions to PostgreSQL.
      .groupBy(sql`1`);
    const options = current.options ?? [];
    const known = new Set(options.map((o) => o.id));
    const counts = new Map(rows.map((row) => [row.optionId, row.count]));
    return {
      items: [
        ...options.map((o) => ({
          optionId: o.id,
          label: o.label,
          count: counts.get(o.id) ?? 0,
        })),
        {
          optionId: null,
          label: "Not set",
          count: rows
            .filter((row) => row.optionId === null || !known.has(row.optionId))
            .reduce((sum, row) => sum + row.count, 0),
        },
      ],
    };
  },
});

/** Checks a value against its definition; '' and [] unset it (null). */
function normalize(
  definition: Awaited<ReturnType<typeof findAttribute>>,
  value: unknown,
): unknown {
  if (value === null || value === "") return null;
  const fail = (expected: string): never => {
    throw invalid(`Attribute '${definition.key}' expects ${expected}`);
  };
  const ids = new Set((definition.options ?? []).map((o) => o.id));
  switch (definition.fieldType) {
    case "text":
      return typeof value === "string"
        ? value.trim() || null
        : fail("a text value");
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : fail("a number");
    case "checkbox":
      return typeof value === "boolean" ? value : fail("true or false");
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? value.trim()
        : fail("a date");
    case "select":
      return typeof value === "string" && ids.has(value)
        ? value
        : fail("one of its option IDs");
    case "multi_select": {
      if (
        !Array.isArray(value) ||
        !value.every((v) => typeof v === "string" && ids.has(v))
      )
        return fail("an array of its option IDs");
      const unique = [...new Set(value as string[])];
      return unique.length ? unique : null;
    }
  }
}

const setValue = defineQuillsRoute({
  method: "put",
  path: "/conversations/{conversationId}/attributes/{key}",
  operationId: "setQuillsConversationAttributeValue",
  summary: "Set or clear an attribute value on a conversation",
  description:
    "Checked against the live definition (404 unknown key, 409 archived). null, '' and [] clear it. Recorded as a teammate value.",
  action: "update",
  params: conversationParams.extend({
    key: z
      .string()
      .min(1)
      .max(64)
      // Imported keys may also carry dots and hyphens; new keys are snake_case.
      .regex(/^[a-z0-9_.-]+$/),
  }),
  body: z.object({
    value: z
      .union([
        z.string().max(1000),
        z.number(),
        z.boolean(),
        z.array(z.string().max(100)).max(100),
      ])
      .nullable(),
  }),
  response: z.object({
    conversationId: z.string(),
    attributes: z.array(attributeEntry),
  }),
  responseDescription: "The conversation's attribute values",
  errors,
  event: ({ params }) => ({
    type: "conversation.attribute_changed",
    entityType: "conversation",
    entityId: params.conversationId,
    payload: { key: params.key },
  }),
  handler: async ({ db, params, body }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const [definition] = await db
      .select(fields)
      .from(definitions)
      .where(eq(definitions.key, params.key));
    if (!definition) throw notFound("Attribute");
    if (definition.archivedAt)
      throw conflict(`Attribute '${params.key}' is archived`);
    const value = normalize(definition, body.value);
    // One statement merges the key, so a parallel write to another key is kept.
    const patch =
      value === null
        ? sql`${conversations.customAttributes} - ${params.key}::text`
        : sql`${conversations.customAttributes} || ${JSON.stringify({
            [params.key]: {
              v: value,
              src: "teammate",
              at: new Date().toISOString(),
            },
          })}::jsonb`;
    const [row] = await db
      .update(conversations)
      .set({ customAttributes: patch, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id))
      .returning({ customAttributes: conversations.customAttributes });
    return {
      conversationId: conversation.id,
      attributes: attributeEntries(row!.customAttributes),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listAttributes)
  .openapi(...createAttribute)
  .openapi(...updateAttribute)
  .openapi(...archiving("archive"))
  .openapi(...archiving("restore"))
  .openapi(...valueCounts)
  .openapi(...setValue);
