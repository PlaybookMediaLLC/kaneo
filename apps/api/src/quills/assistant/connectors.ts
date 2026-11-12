import { asc, eq, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import {
  CONNECTOR_AUTH_MODES,
  CONNECTOR_STATUSES,
  CONNECTOR_TOOL_POLICIES,
  connectors,
  DEFAULT_CONNECTOR_TOOL_POLICIES,
} from "../../database/quills/schema/connectors";
import { someField } from "../feedback/schemas";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  credentialText,
  openCredentials,
  sealCredentials,
} from "../framework/integration-config";
import {
  mintOAuthState,
  oauthState,
  type SignedVerifier,
} from "../framework/signed";
import { slugify } from "../content/help-center/shared";
import { signedUrl } from "../integrations/oauth-providers";
import { uniqueConflict } from "../support/conversation-model";
import {
  catalog,
  discover,
  failureText,
  finishAuthorization,
  MAX_TOOLS,
  startAuthorization,
  type DiscoveredTool,
  type Failure,
  type Secrets,
} from "./connector-client";
import { toolCatalogue } from "./tools";

// Remote MCP connectors and the built-in tool catalogue. A settings manager adds, changes, refreshes
// and authorizes a connector. The URL is reached only through connector-client.ts, never inside a
// transaction: `prepare` reads, `call` reaches the server, the handler writes. Credentials are sealed
// with the instance key and never returned. The copilot calls connector tools (ROUTES.md).

const MAX_CONNECTORS = 100;
const params = z.object({ connectorId: flexibleToTypeIdSchema("connector") });
type ConnectorId = z.output<typeof params>["connectorId"];
const policy = z.enum(CONNECTOR_TOOL_POLICIES);
const assignments = z.object({ agent: z.boolean(), copilot: z.boolean() });
/** The default for each group, and the per-tool overrides (stored as a map by tool name). */
const policiesSchema = z.object({
  groupDefaults: z.object({ read: policy, write: policy }),
  tools: z
    .array(z.object({ name: z.string().min(1).max(128), policy }))
    .max(MAX_TOOLS),
});

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
const detailSchema = connectorSchema.extend({
  /** True when a credential is stored. The credential itself is never returned. */
  hasSecret: z.boolean(),
  enabled: z.boolean(),
  assignments,
  toolPolicies: policiesSchema,
  tools: z.array(
    z.object({
      name: z.string(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      group: z.enum(["read", "write"]),
      destructive: z.boolean(),
      policy,
    }),
  ),
  lastSyncedAt: nullableResponseTimestamp,
  lastCallAt: nullableResponseTimestamp,
  lastErrorAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
});
const detailColumns = {
  id: connectors.id,
  name: connectors.name,
  slug: connectors.slug,
  url: connectors.url,
  authMode: connectors.authMode,
  status: connectors.status,
  lastError: connectors.lastError,
  updatedAt: connectors.updatedAt,
  hasSecret: sql<boolean>`${connectors.secrets} IS NOT NULL`,
  enabled: connectors.enabled,
  assignments: connectors.assignments,
  toolPolicies: connectors.toolPolicies,
  tools: connectors.tools,
  lastSyncedAt: connectors.lastSyncedAt,
  lastCallAt: connectors.lastCallAt,
  lastErrorAt: connectors.lastErrorAt,
  createdAt: connectors.createdAt,
};
const selectDetail = (db: Database) =>
  db.select(detailColumns).from(connectors);
/** The client view: each tool's group and its effective policy. */
function view(row: Awaited<ReturnType<typeof selectDetail>>[number]) {
  const groupDefaults =
    row.toolPolicies?.groupDefaults ??
    DEFAULT_CONNECTOR_TOOL_POLICIES.groupDefaults;
  const overrides = row.toolPolicies?.tools ?? {};
  return {
    ...row,
    assignments: {
      agent: row.assignments?.agent === true,
      copilot: row.assignments?.copilot === true,
    },
    toolPolicies: {
      groupDefaults,
      tools: Object.entries(overrides).map(([name, policy]) => ({
        name,
        policy,
      })),
    },
    toolCount: row.tools.length,
    tools: row.tools.map((tool) => {
      const group = tool.annotations?.readOnlyHint === true ? "read" : "write";
      return {
        name: tool.name,
        title: tool.title ?? null,
        description: tool.description ?? null,
        group,
        destructive: tool.annotations?.destructiveHint === true,
        // Own keys only: a tool named `constructor` must not read Object.prototype.
        policy: Object.hasOwn(overrides, tool.name)
          ? overrides[tool.name]!
          : groupDefaults[group],
      } as const;
    }),
  };
}

const notFound = () =>
  new HTTPException(404, { message: "Connector not found" });
const duplicate = uniqueConflict(
  "Another connector already uses a similar name",
);
/** The tool namespace: at most 20 characters, as in the source. */
const slugOf = (name: string) => slugify(name, "connector").slice(0, 20);

/** 409 when the limit is reached or another connector has this name or slug (ignoring case). */
async function available(db: Database, name: string, slug: string) {
  if ((await db.$count(connectors)) >= MAX_CONNECTORS)
    throw new HTTPException(409, {
      message: `A workspace has at most ${MAX_CONNECTORS} connectors`,
    });
  const [taken] = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(
      or(
        sql`lower(${connectors.slug}) = ${slug}`,
        sql`lower(${connectors.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (taken)
    throw new HTTPException(409, {
      message: "Another connector already uses a similar name",
    });
}

/** Sealed secrets, or null for none. 409 when the instance key is missing. */
const seal = (secrets: Secrets) =>
  Object.keys(secrets).length ? sealCredentials(secrets) : null;

/** What `call` needs, read in `prepare`. `sealed` lets the handler see whether the secrets changed. */
async function stored(db: Database, id: ConnectorId) {
  const [row] = await db
    .select({
      url: connectors.url,
      authMode: connectors.authMode,
      sealed: connectors.secrets,
    })
    .from(connectors)
    .where(eq(connectors.id, id));
  if (!row) throw notFound();
  // Secrets that this instance cannot read (an imported connector) count as none.
  const secrets = openCredentials(row.sealed) ?? {};
  return {
    ...row,
    target: {
      url: row.url,
      authMode: row.authMode,
      secrets,
      // The connector's signed callback, which its OAuth client registers.
      redirectUrl: signedUrl(`/oauth/connectors/${id}/callback`),
    },
  };
}

/**
 * Locks the connector for the write. 409 when its URL, auth mode or secrets changed since `prepare`:
 * a result for the old URL or old credentials must not overwrite the new ones.
 */
async function unchanged(
  db: Database,
  id: ConnectorId,
  seen: Awaited<ReturnType<typeof stored>>,
) {
  const [row] = await db
    .select({
      url: connectors.url,
      authMode: connectors.authMode,
      sealed: connectors.secrets,
      tools: connectors.tools,
      toolPolicies: connectors.toolPolicies,
    })
    .from(connectors)
    .where(eq(connectors.id, id))
    .for("update");
  if (!row) throw notFound();
  if (
    row.url !== seen.url ||
    row.authMode !== seen.authMode ||
    row.sealed !== seen.sealed
  )
    throw new HTTPException(409, {
      message: "The connector changed during the request. Try again.",
    });
  return row;
}

/** A failed step as the route's answer. The server's own text never reaches the caller. */
const failed = (failure: Failure) =>
  new HTTPException(failure === "unreachable" ? 502 : 400, {
    message: failureText[failure],
  });

/** The columns a discovery writes: the new catalogue, or the failure. */
function outcome(
  current: Pick<typeof connectors.$inferSelect, "tools" | "toolPolicies">,
  found: { tools?: DiscoveredTool[]; failure?: Failure },
) {
  const now = new Date();
  return found.tools
    ? {
        ...catalog(current.tools, found.tools, current.toolPolicies),
        status: "connected" as const,
        lastSyncedAt: now,
        lastError: null,
        lastErrorAt: null,
      }
    : {
        status: "error" as const,
        lastError: failureText[found.failure ?? "unreachable"],
        lastErrorAt: now,
        errorCount: sql`${connectors.errorCount} + 1`,
      };
}

const errors = {
  404: "Connector not found",
  409: "The connector changed during the request, or NOTIFICATION_SECRET_ENCRYPTION_KEY is not set",
};
const name = z.string().trim().min(1).max(80);
const url = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) => URL.canParse(value) && new URL(value).protocol === "https:",
    "Enter an HTTPS MCP server URL",
  );
const bearerToken = z.string().min(1).max(4000).regex(credentialText);

const listConnectors = defineQuillsRoute({
  method: "get",
  path: "/assistant/connectors",
  operationId: "listQuillsConnectors",
  summary: "List the assistant connectors",
  description:
    "Never returns credentials. The copilot calls the tools of an enabled, connected connector that is assigned to it.",
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

const getConnector = defineQuillsRoute({
  method: "get",
  path: "/assistant/connectors/{connectorId}",
  operationId: "getQuillsConnector",
  summary: "Get an assistant connector",
  description: "With its tools and their policies. Never returns credentials.",
  action: "manage_settings",
  params,
  response: detailSchema,
  responseDescription: "The connector",
  allowKeys: ["hasSecret"],
  errors: { 404: "Connector not found" },
  handler: async ({ db, params }) => {
    const [row] = await selectDetail(db).where(
      eq(connectors.id, params.connectorId),
    );
    if (!row) throw notFound();
    return view(row);
  },
});

const createConnector = defineQuillsRoute({
  method: "post",
  path: "/assistant/connectors",
  operationId: "createQuillsConnector",
  summary: "Add an assistant connector",
  description: `Connects to the MCP server and stores its tools. With authMode oauth, or when the server asks for authorization, the connector is stored with status error; start its authorization next. Names are unique, ignoring case. A workspace has at most ${MAX_CONNECTORS} connectors. A bearer token is stored encrypted and never returned.`,
  action: "manage_settings",
  body: z
    .object({
      name,
      url,
      authMode: z.enum(CONNECTOR_AUTH_MODES).default("none"),
      bearerToken: bearerToken.optional(),
      assignments: assignments.default({ agent: false, copilot: true }),
    })
    .refine(
      (body) => (body.authMode === "bearer") === Boolean(body.bearerToken),
      { message: "Send a bearer token with authMode bearer, and only then" },
    ),
  response: detailSchema,
  responseDescription: "The new connector",
  allowKeys: ["hasSecret"],
  errors: {
    400: "The address is not allowed, or the server refused the bearer token",
    409: "Another connector has this name, the limit is reached, or NOTIFICATION_SECRET_ENCRYPTION_KEY is not set",
    502: "The MCP server could not be reached",
  },
  event: (_input, connector) => ({
    type: "assistant_connector.created",
    entityType: "assistant_connector",
    entityId: connector.id,
  }),
  prepare: async ({ db, body }) => {
    const slug = slugOf(body.name);
    await available(db, body.name, slug);
    const secrets: Secrets = body.bearerToken
      ? { bearerToken: body.bearerToken }
      : {};
    return { slug, secrets, sealed: seal(secrets) };
  },
  call: async (prepared, { body }) => {
    if (body.authMode === "oauth") return { ...prepared, tools: null };
    const found = await discover({
      url: body.url,
      authMode: body.authMode,
      secrets: prepared.secrets,
    });
    // A server without a bearer token that asks for authorization becomes an OAuth connector.
    if (found.failure === "unauthorized" && body.authMode === "none")
      return { ...prepared, tools: null };
    if (found.failure)
      throw found.failure === "unauthorized"
        ? new HTTPException(400, {
            message: "The MCP server refused the bearer token.",
          })
        : failed(found.failure);
    return { ...prepared, tools: found.tools! };
  },
  handler: async ({ db, actor, body, called }) => {
    await available(db, body.name, called.slug);
    const state = called.tools
      ? {
          ...catalog([], called.tools, null),
          authMode: body.authMode,
          status: "connected" as const,
          lastSyncedAt: new Date(),
        }
      : {
          authMode: "oauth" as const,
          status: "error" as const,
          lastError: failureText.unauthorized,
          lastErrorAt: new Date(),
        };
    const [row] = await db
      .insert(connectors)
      .values({
        name: body.name,
        slug: called.slug,
        url: body.url,
        secrets: called.sealed,
        assignments: body.assignments,
        createdByPrincipalId: actor.principalId,
        ...state,
      })
      .returning(detailColumns)
      .catch(duplicate);
    return view(row!);
  },
});

const updateConnector = defineQuillsRoute({
  method: "patch",
  path: "/assistant/connectors/{connectorId}",
  operationId: "updateQuillsConnector",
  summary: "Update an assistant connector",
  description:
    "Does not reach the server; refresh it after a change. A new URL removes the stored credentials, unless the same request sends a bearer token, and sets status error.",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: name.optional(),
      url: url.optional(),
      authMode: z.enum(CONNECTOR_AUTH_MODES).optional(),
      bearerToken: bearerToken.optional(),
      clearBearerToken: z.boolean().optional(),
      assignments: assignments.optional(),
      toolPolicies: policiesSchema.optional(),
      enabled: z.boolean().optional(),
    })
    .refine(someField, { message: "Change at least one field" }),
  response: detailSchema,
  responseDescription: "The updated connector",
  allowKeys: ["hasSecret"],
  errors: {
    404: "Connector not found",
    409: "Another connector has this name, or NOTIFICATION_SECRET_ENCRYPTION_KEY is not set",
  },
  event: ({ params }) => ({
    type: "assistant_connector.updated",
    entityType: "assistant_connector",
    entityId: params.connectorId,
  }),
  handler: async ({ db, params, body }) => {
    const [existing] = await db
      .select({ url: connectors.url, sealed: connectors.secrets })
      .from(connectors)
      .where(eq(connectors.id, params.connectorId))
      .for("update");
    if (!existing) throw notFound();
    const moved = body.url !== undefined && body.url !== existing.url;
    let secrets: string | null | undefined;
    if (moved || body.bearerToken || body.clearBearerToken) {
      // A token never goes to a URL that it was not given for.
      const next: Secrets = moved
        ? {}
        : { ...openCredentials(existing.sealed) };
      if (body.clearBearerToken) delete next.bearerToken;
      if (body.bearerToken) next.bearerToken = body.bearerToken;
      secrets = seal(next);
    }
    const [row] = await db
      .update(connectors)
      .set({
        name: body.name,
        // The unique indexes on the name and the slug answer 409 (duplicate).
        slug: body.name && slugOf(body.name),
        url: body.url,
        authMode: body.authMode,
        secrets,
        assignments: body.assignments,
        toolPolicies: body.toolPolicies && {
          groupDefaults: body.toolPolicies.groupDefaults,
          tools: Object.fromEntries(
            body.toolPolicies.tools.map((tool) => [tool.name, tool.policy]),
          ),
        },
        enabled: body.enabled,
        updatedAt: new Date(),
        ...(moved && {
          status: "error" as const,
          lastError: "The URL changed. Refresh the connector.",
          lastErrorAt: new Date(),
        }),
      })
      .where(eq(connectors.id, params.connectorId))
      .returning(detailColumns)
      .catch(duplicate);
    return view(row!);
  },
});

const refreshConnector = defineQuillsRoute({
  method: "post",
  path: "/assistant/connectors/{connectorId}/refresh",
  operationId: "refreshQuillsConnector",
  summary: "Refresh an assistant connector's tools",
  description:
    "Connects to the MCP server and stores its tools. A failure is stored as status error with a fixed message; the request still succeeds. Refreshed OAuth tokens are kept.",
  action: "manage_settings",
  params,
  response: detailSchema,
  responseDescription: "The connector after the refresh",
  allowKeys: ["hasSecret"],
  errors,
  event: ({ params }) => ({
    type: "assistant_connector.refreshed",
    entityType: "assistant_connector",
    entityId: params.connectorId,
  }),
  prepare: ({ db, params }) => stored(db, params.connectorId),
  call: async (prepared) => ({
    prepared,
    found: await discover(prepared.target),
  }),
  handler: async ({ db, params, called }) => {
    const { prepared, found } = called;
    const current = await unchanged(db, params.connectorId, prepared);
    // Tokens that a failed step dropped are not stored: a parallel refresh may hold the rotated ones.
    const changed =
      JSON.stringify(found.secrets) !==
        JSON.stringify(prepared.target.secrets) &&
      !(prepared.target.secrets.tokens && !found.secrets.tokens);
    const [row] = await db
      .update(connectors)
      .set({
        ...outcome(current, found),
        ...(changed && { secrets: seal(found.secrets) }),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, params.connectorId))
      .returning(detailColumns);
    return view(row!);
  },
});

/** The state names the connector as its provider type, so a state for one connector fails on another. */
const stateType = (id: string) => `connector:${id}`;
/** The integration callback's checks (framework/signed.ts), with the connector of the path as the type. */
const connectorState: SignedVerifier = {
  name: "connector-oauth-state",
  locate: (request) =>
    oauthState.locate({
      ...request,
      params: { type: stateType(request.params.connectorId ?? "") },
    }),
};

const startOAuth = defineQuillsRoute({
  method: "post",
  path: "/assistant/connectors/{connectorId}/oauth",
  operationId: "startQuillsConnectorOAuth",
  summary: "Start a connector's OAuth authorization",
  description:
    "Registers this instance with the server's authorization server when needed and returns the authorization URL. Open it in the same browser session: the state expires after ten minutes, is bound to the caller, this workspace and the connector, and works once. Stored tokens stay until the callback replaces them.",
  action: "manage_settings",
  params,
  response: z.object({ authorizationUrl: z.string() }),
  responseDescription: "The authorization URL",
  errors: {
    400: "The address is not allowed, or the authorization server refused the request",
    404: "Connector not found",
    409: "The connector does not use OAuth, it changed during the request, or NOTIFICATION_SECRET_ENCRYPTION_KEY is not set",
    502: "The MCP server could not be reached",
  },
  event: ({ params }) => ({
    type: "assistant_connector.updated",
    entityType: "assistant_connector",
    entityId: params.connectorId,
  }),
  prepare: async ({ db, params, actor }) => {
    const prepared = await stored(db, params.connectorId);
    if (prepared.authMode !== "oauth")
      throw new HTTPException(409, {
        message: "This connector does not use OAuth.",
      });
    const state = mintOAuthState({
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      type: stateType(params.connectorId),
    });
    return { prepared, state };
  },
  call: async ({ prepared, state }) => {
    const started = await startAuthorization(prepared.target, state);
    if (!started.secrets) throw failed(started.failure);
    return { prepared, started };
  },
  handler: async ({ db, params, called }) => {
    await unchanged(db, params.connectorId, called.prepared);
    await db
      .update(connectors)
      .set({ secrets: seal(called.started.secrets), updatedAt: new Date() })
      .where(eq(connectors.id, params.connectorId));
    return { authorizationUrl: called.started.authorizationUrl };
  },
});

/** The teammate actor of a Kaneo account; it exists since the account joined the workspace. 403 otherwise. */
async function teammate(db: Database, userId: string) {
  const [row] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(eq(principal.kaneoUserId, userId));
  if (!row)
    throw new HTTPException(403, { message: "Insufficient permission" });
  return row.id;
}

const completeOAuth = defineQuillsRoute({
  audience: "signed",
  verifier: connectorState,
  method: "get",
  path: "/oauth/connectors/{connectorId}/callback",
  operationId: "completeQuillsConnectorOAuth",
  summary: "Complete a connector's OAuth authorization",
  description:
    "The authorization server redirects the browser here. The signed state must be unexpired, unused, for this connector and for the signed-in account, which must still hold quills:manage_settings in the state's workspace. Exchanges the code, then refreshes the connector's tools. `connected` means that the authorization is complete; the connector's own status tells whether its tools were read.",
  action: "manage_settings",
  params,
  query: z.object({
    state: z.string().min(1).max(2048),
    code: z.string().min(1).max(2048).optional(),
    error: z.string().max(200).optional(),
  }),
  response: z.object({
    status: z.enum(["connected", "already_used"]),
    connector: detailSchema.nullable(),
  }),
  responseDescription: "The connector without its credentials",
  allowKeys: ["hasSecret"],
  errors: {
    400: "Access was not granted, or the authorization server rejected the code",
    403: "The account no longer manages Quills settings",
    404: "Connector not found",
    409: "No authorization is in progress, or the connector changed during the request",
    502: "The authorization server could not be reached",
  },
  replay: { status: "already_used", connector: null },
  prepare: async ({ db, params, query }) => {
    if (!query.code)
      throw new HTTPException(400, { message: "Access was not granted." });
    const prepared = await stored(db, params.connectorId);
    if (prepared.authMode !== "oauth" || !prepared.target.secrets.codeVerifier)
      throw new HTTPException(409, {
        message: "No authorization is in progress. Start it again.",
      });
    return { prepared, code: query.code };
  },
  call: async ({ prepared, code }) => {
    const finished = await finishAuthorization(prepared.target, code);
    if (!finished.secrets) throw failed(finished.failure);
    return {
      prepared,
      found: await discover({
        ...prepared.target,
        secrets: finished.secrets,
      }),
    };
  },
  event: ({ params }) => ({
    type: "assistant_connector.connected",
    entityType: "assistant_connector",
    entityId: params.connectorId,
  }),
  // The audit row names the teammate who started the authorization.
  actor: (db, located) => teammate(db, located.claims?.userId ?? ""),
  handler: async ({ db, params, called }) => {
    const { prepared, found } = called;
    const current = await unchanged(db, params.connectorId, prepared);
    const [row] = await db
      .update(connectors)
      .set({
        ...outcome(current, found),
        secrets: seal(found.secrets),
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, params.connectorId))
      .returning(detailColumns);
    return { status: "connected" as const, connector: view(row!) };
  },
});

const deleteConnector = defineQuillsRoute({
  method: "delete",
  path: "/assistant/connectors/{connectorId}",
  operationId: "deleteQuillsConnector",
  summary: "Delete an assistant connector",
  description: "Its stored credentials go with it.",
  action: "manage_settings",
  params,
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
    if (!row) throw notFound();
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
  .openapi(...listTools)
  .openapi(...getConnector)
  .openapi(...createConnector)
  .openapi(...updateConnector)
  .openapi(...refreshConnector)
  .openapi(...startOAuth);

/** The signed OAuth callback, mounted from quills/public.ts. */
export const connectorOAuthCallback = apiRouter().openapi(...completeOAuth);
