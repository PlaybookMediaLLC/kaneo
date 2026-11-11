import { asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  CONNECTOR_AUTH_MODES,
  CONNECTOR_STATUSES,
  connectors,
} from "../../database/quills/schema/connectors";
import { defineQuillsRoute } from "../framework/define-route";
import { toolCatalogue } from "./tools";

// Remote MCP connectors kept from an imported workspace, and the built-in tool catalogue.
// This build has no MCP client, so it lists and removes connectors but cannot add or call them.

const connectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  url: z.string(),
  authMode: z.enum(CONNECTOR_AUTH_MODES),
  status: z.enum(CONNECTOR_STATUSES),
  toolCount: z.number(),
  lastError: z.string().nullable(),
  updatedAt: nullableResponseTimestamp,
});

const listConnectors = defineQuillsRoute({
  method: "get",
  path: "/assistant/connectors",
  operationId: "listQuillsConnectors",
  summary: "List the assistant connectors",
  description:
    "Never returns credentials. This build cannot call a connector's tools.",
  action: "manage_settings",
  response: z.object({ items: z.array(connectorSchema) }),
  responseDescription: "The connectors, by name",
  handler: async ({ db }) => ({
    items: await db
      .select({
        id: connectors.id,
        name: connectors.name,
        slug: connectors.slug,
        url: connectors.url,
        authMode: connectors.authMode,
        status: connectors.status,
        toolCount: sql<number>`jsonb_array_length(${connectors.tools})::int`,
        lastError: connectors.lastError,
        updatedAt: connectors.updatedAt,
      })
      .from(connectors)
      .orderBy(asc(connectors.name))
      .limit(100),
  }),
});

const deleteConnector = defineQuillsRoute({
  method: "delete",
  path: "/assistant/connectors/{connectorId}",
  operationId: "deleteQuillsConnector",
  summary: "Delete an assistant connector",
  description: "Its stored credentials go with it.",
  action: "manage_settings",
  params: z.object({ connectorId: flexibleToTypeIdSchema("connector") }),
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted connector's ID",
  errors: { 404: "Connector not found" },
  event: ({ params }) => ({
    type: "assistant_connector.deleted",
    entityType: "assistant_connector",
    entityId: params.connectorId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .delete(connectors)
      .where(eq(connectors.id, params.connectorId))
      .returning({ id: connectors.id });
    if (!row) throw new HTTPException(404, { message: "Connector not found" });
    return { id: row.id };
  },
});

const listTools = defineQuillsRoute({
  method: "get",
  path: "/assistant/tools",
  operationId: "listQuillsAssistantTools",
  summary: "List the assistant's built-in tools",
  description:
    "A read tool runs with the asking teammate's access. A write tool only proposes; it runs when a teammate with `requires` approves it.",
  action: "manage_settings",
  response: z.object({
    items: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(["read", "write"]),
        description: z.string(),
        requires: z.enum(["read", "update"]),
      }),
    ),
  }),
  responseDescription: "The tools",
  handler: async () => ({ items: toolCatalogue }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listConnectors)
  .openapi(...deleteConnector)
  .openapi(...listTools);
