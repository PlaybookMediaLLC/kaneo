import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  integrationEventMappings as mappings,
  integrations,
} from "../../database/quills/schema/integrations";
import { defineQuillsRoute } from "../framework/define-route";
import { catalog, deliveredEvent } from "./catalog";
import {
  DEFAULT_TARGET,
  channelView,
  channelsOf,
  eventState,
  mappingColumns,
  upsert,
} from "./channels";
import {
  checkEvents,
  findIntegration,
  integrationParams,
  integrationSummary,
  summary,
  summaryColumns,
} from "./connect";

// Credentials live encrypted in integrations.secrets; no route selects that column.
const errors = { 403: "Insufficient permission", 404: "Integration not found" };

const listIntegrations = defineQuillsRoute({
  method: "get",
  path: "/integrations",
  operationId: "listQuillsIntegrations",
  summary: "List connected integrations",
  action: "read",
  response: z.object({ integrations: z.array(integrationSummary) }),
  responseDescription: "Connections without their credentials",
  errors: { 403: errors[403] },
  handler: async ({ db }) => ({
    integrations: (
      await db
        .select(summaryColumns)
        .from(integrations)
        .orderBy(integrations.integrationType)
        .limit(100)
    ).map(summary),
  }),
});

const listCatalog = defineQuillsRoute({
  method: "get",
  path: "/integration-catalog",
  operationId: "listQuillsIntegrationCatalog",
  summary: "List the integration catalog",
  description:
    "Static provider metadata. `available` says whether this build can connect the provider; `events` lists the event types it delivers.",
  action: "read",
  response: z.object({
    providers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.string(),
        description: z.string(),
        available: z.boolean(),
        events: z.array(z.string()),
      }),
    ),
  }),
  responseDescription: "The catalog",
  errors: { 403: errors[403] },
  handler: async () => ({ providers: catalog }),
});

const getIntegration = defineQuillsRoute({
  method: "get",
  path: "/integrations/{integrationId}",
  operationId: "getQuillsIntegration",
  summary: "Get an integration with its event mappings and channels",
  action: "manage_settings",
  params: integrationParams,
  response: z.object({
    integration: integrationSummary.extend({
      lastOutboundAt: z.string().nullable(),
      lastError: z.string().nullable(),
      lastErrorAt: z.string().nullable(),
      errorCount: z.number(),
    }),
    eventMappings: z.array(eventState),
    channels: z.array(channelView),
  }),
  responseDescription: "The connection without its credentials",
  errors,
  handler: async ({ db, params }) => {
    const [row] = await db
      .select({
        ...summaryColumns,
        lastOutboundAt: integrations.lastOutboundAt,
        lastError: integrations.lastError,
        lastErrorAt: integrations.lastErrorAt,
        errorCount: integrations.errorCount,
      })
      .from(integrations)
      .where(eq(integrations.id, params.integrationId));
    if (!row) throw new HTTPException(404, { message: errors[404] });
    const rows = await db
      .select(mappingColumns)
      .from(mappings)
      .where(eq(mappings.integrationId, params.integrationId))
      .orderBy(mappings.targetKey, mappings.eventType)
      .limit(1000);
    return {
      integration: {
        ...summary(row),
        lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
        lastError: row.lastError,
        lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
        errorCount: row.errorCount,
      },
      eventMappings: rows
        .filter((mapping) => mapping.targetKey === DEFAULT_TARGET)
        .map(({ eventType, enabled }) => ({ eventType, enabled })),
      channels: channelsOf(rows),
    };
  },
});

const updateIntegration = defineQuillsRoute({
  method: "patch",
  path: "/integrations/{integrationId}",
  operationId: "updateQuillsIntegration",
  summary: "Enable or pause an integration and set its event mappings",
  description:
    "`eventMappings` turn event types on or off for the connection itself (the default target). A paused integration delivers nothing.",
  action: "manage_settings",
  params: integrationParams,
  body: z
    .object({
      enabled: z.boolean().optional(),
      eventMappings: z
        .array(z.object({ eventType: deliveredEvent, enabled: z.boolean() }))
        .min(1)
        .max(20)
        .optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Nothing to update"),
  response: z.object({ integration: integrationSummary }),
  responseDescription: "The updated connection",
  errors,
  event: ({ params }) => ({
    type: "integration.updated",
    entityType: "integration",
    entityId: params.integrationId,
  }),
  handler: async ({ db, params, body }) => {
    const current = await findIntegration(db, params.integrationId);
    if (body.eventMappings) {
      checkEvents(
        current.integrationType,
        body.eventMappings.map((mapping) => mapping.eventType),
      );
      await upsert(
        db,
        params.integrationId,
        DEFAULT_TARGET,
        body.eventMappings,
        null,
      );
    }
    const [row] = await db
      .update(integrations)
      .set({
        status:
          body.enabled === undefined
            ? undefined
            : body.enabled
              ? "active"
              : "paused",
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, params.integrationId))
      .returning(summaryColumns);
    return { integration: summary(row!) };
  },
});

const deleteIntegration = defineQuillsRoute({
  method: "delete",
  path: "/integrations/{integrationId}",
  operationId: "deleteQuillsIntegration",
  summary: "Disconnect an integration",
  description:
    "Deletes the connection, its credentials, event mappings and external links. Queued deliveries are cancelled. The sync history rows stay as evidence, but no route lists them without the connection.",
  action: "manage_settings",
  params: integrationParams,
  response: z.object({ deleted: z.boolean() }),
  responseDescription: "Integration deleted",
  errors,
  event: ({ params }) => ({
    type: "integration.deleted",
    entityType: "integration",
    entityId: params.integrationId,
  }),
  handler: async ({ db, params }) => {
    const rows = await db
      .delete(integrations)
      .where(eq(integrations.id, params.integrationId))
      .returning({ id: integrations.id });
    if (!rows.length) throw new HTTPException(404, { message: errors[404] });
    return { deleted: true };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listIntegrations)
  .openapi(...listCatalog)
  .openapi(...getIntegration)
  .openapi(...updateIntegration)
  .openapi(...deleteIntegration);
