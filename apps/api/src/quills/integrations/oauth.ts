import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import {
  integrationEventMappings,
  integrationPlatformCredentials as platform,
  integrations,
} from "../../database/quills/schema/integrations";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  credentialText,
  openCredentials,
  sealCredentials,
} from "../framework/integration-config";
import { mintOAuthState, oauthState } from "../framework/signed";
import {
  connect,
  connectedEvent,
  integrationParams,
  integrationSummary,
  summaryColumns,
} from "./connect";
import {
  failureOf,
  providerFailure,
  redirectUri,
  tokenFields,
  type Destination,
  type ExternalItem,
} from "./oauth-providers";
import {
  freshSecrets,
  oauthApp,
  oauthProvider,
  oauthTypes,
  validTarget,
} from "./providers";

// OAuth connections (the providers in providers/). A teammate saves the workspace's OAuth app
// (platform credentials) and starts a connect; the provider redirects the browser to the signed
// callback, which the state binds to that teammate, workspace and provider. Tokens are sealed with
// NOTIFICATION_SECRET_ENCRYPTION_KEY and never returned. Every provider call runs with no database
// transaction open: read, release, call, then write in a new scoped transaction.

const typeParams = z.object({ type: z.enum(oauthTypes) });
const credentialValue = z.string().min(1).max(500).regex(credentialText);
const notConfigured = () =>
  new HTTPException(409, {
    message: "Save the OAuth app credentials for this provider first.",
  });

/** The workspace's OAuth app for a provider, opened. Undefined when none is saved or readable. */
export async function appCredentials(db: Database, type: string) {
  const [row] = await db
    .select({ secrets: platform.secrets })
    .from(platform)
    .where(eq(platform.integrationType, type));
  return row && openCredentials(row.secrets);
}

const credentialsView = z.object({
  configured: z.boolean(),
  clientId: z.string().nullable(),
  redirectUri: z.string(),
});

const typeQuery = z.object({ type: z.enum(oauthTypes) });

const saveCredentials = defineQuillsRoute({
  method: "put",
  path: "/integration-platform-credentials",
  operationId: "saveQuillsPlatformCredentials",
  summary: "Save the OAuth app credentials for a provider",
  description:
    "Discord also needs the bot token. Secrets are stored encrypted and never returned. Register the returned redirect URI in the provider app.",
  action: "manage_settings",
  body: typeQuery.extend({
    // Nested: the OAuth client ID is a provider value, not an ID in this workspace.
    client: z.object({ id: credentialValue, secret: credentialValue }),
    botToken: credentialValue.optional(),
  }),
  response: credentialsView,
  responseDescription: "The masked credentials",
  errors: {
    403: "Insufficient permission",
    409: "Set NOTIFICATION_SECRET_ENCRYPTION_KEY first",
  },
  event: ({ body }) => ({
    type: "integration.platform_credentials_saved",
    entityType: "integration",
    entityId: body.type,
  }),
  handler: async ({ db, actor, body }) => {
    const fields = oauthProvider(body.type)!.credentials;
    if (fields.includes("botToken") && !body.botToken)
      throw new HTTPException(400, { message: "A bot token is required." });
    const secrets = sealCredentials({
      clientId: body.client.id,
      clientSecret: body.client.secret,
      ...(body.botToken && { botToken: body.botToken }),
    });
    await db
      .insert(platform)
      .values({
        integrationType: body.type,
        secrets,
        configuredByPrincipalId: actor.principalId,
      })
      .onConflictDoUpdate({
        target: [platform.workspaceId, platform.integrationType],
        set: {
          secrets,
          configuredByPrincipalId: actor.principalId,
          updatedAt: new Date(),
        },
      });
    return {
      configured: true,
      clientId: body.client.id,
      redirectUri: redirectUri(body.type),
    };
  },
});

const getCredentials = defineQuillsRoute({
  method: "get",
  path: "/integration-platform-credentials",
  operationId: "getQuillsPlatformCredentials",
  summary: "Get the masked OAuth app credentials for a provider",
  action: "manage_settings",
  query: typeQuery,
  response: credentialsView,
  responseDescription:
    "Whether credentials are saved, the public client ID and the redirect URI",
  handler: async ({ db, query }) => {
    const creds = await appCredentials(db, query.type);
    return {
      configured: Boolean(creds),
      clientId: creds?.clientId ?? null,
      redirectUri: redirectUri(query.type),
    };
  },
});

const deleteCredentials = defineQuillsRoute({
  method: "delete",
  path: "/integration-platform-credentials",
  operationId: "deleteQuillsPlatformCredentials",
  summary: "Delete the OAuth app credentials for a provider",
  description:
    "The connection stays. Without credentials it cannot reconnect, and Discord cannot post.",
  action: "manage_settings",
  query: typeQuery,
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether credentials were deleted",
  event: ({ query }, result) =>
    result.changed && {
      type: "integration.platform_credentials_deleted",
      entityType: "integration",
      entityId: query.type,
    },
  handler: async ({ db, query }) => ({
    changed:
      (
        await db
          .delete(platform)
          .where(eq(platform.integrationType, query.type))
          .returning({ id: platform.id })
      ).length > 0,
  }),
});

/** One connect route per provider, at the source's path: the provider is part of the path, not an input. */
const startConnect = (type: (typeof oauthTypes)[number]) =>
  defineQuillsRoute({
    method: "get",
    path: `/oauth/${type}/connect`,
    operationId: `startQuills${type[0]!.toUpperCase()}${type.slice(1)}OAuthConnect`,
    summary: `Start a ${oauthProvider(type)!.name} OAuth connection`,
    description:
      "Returns the provider's authorization URL. Open it in the same browser session: the state expires after ten minutes, is bound to the caller and this workspace, and works once.",
    action: "manage_settings",
    response: z.object({ authorizeUrl: z.string() }),
    responseDescription: "The provider authorization URL",
    errors: { 403: "Insufficient permission", 409: "No OAuth app credentials" },
    handler: async ({ db, actor }) => {
      const creds = await appCredentials(db, type);
      if (!creds?.clientId) throw notConfigured();
      const state = mintOAuthState({
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        type,
      });
      return {
        authorizeUrl: oauthApp(type).authorizeUrl(
          creds,
          redirectUri(type),
          state,
        ),
      };
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

const callbackResult = z.object({
  status: z.enum(["connected", "already_used"]),
  integration: integrationSummary.nullable(),
});
const callback = defineQuillsRoute({
  audience: "signed",
  verifier: oauthState,
  method: "get",
  path: "/oauth/{type}/callback",
  operationId: "completeQuillsOAuthConnect",
  summary: "Complete an OAuth connection",
  description:
    "The provider redirects the browser here. The signed state must be unexpired, unused, for this provider and for the signed-in account, which must still hold quills:manage_settings in the state's workspace.",
  action: "manage_settings",
  params: typeParams,
  query: z.object({
    state: z.string().min(1).max(2048),
    code: z.string().min(1).max(2048).optional(),
    error: z.string().max(200).optional(),
  }),
  response: callbackResult,
  responseDescription: "The connection without its tokens",
  errors: {
    400: "The provider did not grant access, or rejected the code",
    403: "The account no longer manages Quills settings",
    409: "No OAuth app credentials, or the provider rejected the credentials",
    502: "The provider could not be reached",
  },
  replay: { status: "already_used", integration: null },
  prepare: async ({ db, params, query }) => {
    if (!query.code)
      throw new HTTPException(400, {
        message: "The provider did not grant access.",
      });
    const creds = await appCredentials(db, params.type);
    if (!creds?.clientId || !creds.clientSecret) throw notConfigured();
    return { creds, code: query.code };
  },
  call: ({ creds, code }, { params }) =>
    oauthApp(params.type)
      .exchange(code, redirectUri(params.type), creds)
      .catch(providerFailure),
  event: (input, result) =>
    result.integration
      ? connectedEvent(input, { integration: result.integration })
      : false,
  // The audit row names the teammate who started the connect.
  actor: (db, located) => teammate(db, located.claims?.userId ?? ""),
  handler: async ({ db, params, located, called, workspaceId }) => {
    const userId = located.claims?.userId ?? "";
    const principalId = await teammate(db, userId);
    const result = await connect(
      db,
      { principalId, userId, workspaceId },
      params.type,
      {
        secrets: sealCredentials(called.secrets),
        workspaceName: called.workspaceName,
        account: called.account,
        config: called.config,
      },
    );
    return { status: "connected" as const, integration: result.integration };
  },
});

/** A connection of this provider family with its secrets, for a provider call. 404 otherwise. */
async function oauthConnection(
  db: Database,
  id: z.output<typeof integrationParams>["integrationId"],
) {
  const [row] = await db
    .select({ ...summaryColumns, secrets: integrations.secrets })
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.status, "active")));
  const provider = row && oauthProvider(row.integrationType);
  if (!row || !provider)
    throw new HTTPException(404, { message: "Integration not found" });
  const secrets = openCredentials(row.secrets);
  const creds = (await appCredentials(db, row.integrationType)) ?? {};
  if (!secrets)
    throw new HTTPException(409, {
      message: "The saved credentials cannot be read. Reconnect.",
    });
  return { row, provider, secrets, creds };
}

/**
 * Stores refreshed tokens in the second transaction, unless the connection changed meanwhile. Only
 * the token fields change: a status-sync secret written or removed during the call stays as it is.
 */
export async function keepRefreshed(
  db: Database,
  connection: Connection,
  refreshed: Record<string, string> | null,
) {
  if (!refreshed) return;
  const [row] = await db
    .select({
      connectedAt: integrations.connectedAt,
      secrets: integrations.secrets,
    })
    .from(integrations)
    .where(eq(integrations.id, connection.id))
    .for("update");
  if (
    !row ||
    (row.connectedAt?.toISOString() ?? null) !== connection.connectedAt
  )
    return;
  await db
    .update(integrations)
    .set({
      secrets: sealCredentials({
        ...openCredentials(row.secrets),
        ...tokenFields(refreshed),
      }),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, connection.id));
}
type Connection = {
  id: z.output<typeof integrationParams>["integrationId"];
  connectedAt: string | null;
};

/**
 * A provider call with a fresh token. A failure after a refresh keeps the refreshed tokens: the
 * handler stores them and the route answers the failure after commit (GitLab rotates the refresh token).
 */
async function withToken<T>(
  prepared: {
    type: string;
    secrets: Record<string, string>;
    creds: Record<string, string>;
  },
  work: (secrets: Record<string, string>) => Promise<T>,
) {
  let refreshed: Record<string, string> | null = null;
  try {
    const fresh = await freshSecrets(
      prepared.type,
      prepared.secrets,
      prepared.creds,
    );
    refreshed = fresh.refreshed;
    return { data: await work(fresh.secrets), refreshed, failure: null };
  } catch (error) {
    return { data: null, refreshed, failure: failureOf(error) };
  }
}

const listDestinations = defineQuillsRoute({
  method: "get",
  path: "/integrations/{integrationId}/destinations",
  operationId: "listQuillsIntegrationDestinations",
  summary: "List the channels an OAuth connection can send to",
  description:
    "Repositories (GitHub), projects (GitLab) or channels (Slack, Discord), at most 200. Calls the provider.",
  action: "manage_settings",
  params: integrationParams,
  response: z.object({
    destinations: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
  responseDescription: "Destinations, in the provider's order",
  errors: {
    403: "Insufficient permission",
    404: "Integration not found",
    409: "Reconnect the integration",
    502: "The provider could not be reached",
  },
  prepare: async ({ db, params }) => {
    const { row, secrets, creds } = await oauthConnection(
      db,
      params.integrationId,
    );
    return {
      type: row.integrationType,
      connection: {
        id: row.id,
        connectedAt: row.connectedAt?.toISOString() ?? null,
      },
      secrets,
      creds,
      config: row.config,
    };
  },
  call: async (prepared) => ({
    connection: prepared.connection,
    ...(await withToken(prepared, (secrets) =>
      oauthProvider(prepared.type)!.destinations(
        secrets,
        prepared.config,
        prepared.creds,
      ),
    )),
  }),
  failure: (called) => called.failure,
  handler: async ({ db, called }) => {
    await keepRefreshed(db, called.connection, called.refreshed);
    return {
      destinations: (called.data ?? ([] as Destination[])).slice(0, 200),
    };
  },
});

const searchItems = defineQuillsRoute({
  method: "get",
  path: "/integrations/{integrationId}/external-items",
  operationId: "searchQuillsExternalItems",
  summary: "Search issues in a repository or project of an OAuth connection",
  description:
    "At most 20 results, only in a repository or project that is one of the integration's channels. Search qualifiers are ignored. Calls the provider. GitHub and GitLab only.",
  // Linking a post to an issue is an update; viewers do not search the connected account.
  action: "update",
  params: integrationParams,
  query: z.object({
    target: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/),
    query: z.string().trim().min(1).max(200),
  }),
  response: z.object({
    items: z.array(
      z.object({
        externalId: z.string(),
        title: z.string(),
        url: z.string().nullable(),
        state: z.string(),
      }),
    ),
  }),
  responseDescription: "Matching issues",
  errors: {
    403: "Insufficient permission",
    404: "Integration or channel not found",
    409: "Reconnect the integration, or it has no item search",
    502: "The provider could not be reached",
  },
  prepare: async ({ db, params, query }) => {
    const { row, provider, secrets, creds } = await oauthConnection(
      db,
      params.integrationId,
    );
    if (!provider.search)
      throw new HTTPException(409, {
        message: "This integration has no item search.",
      });
    // Only a channel that a settings manager configured: the token may reach far more.
    const [channel] = validTarget(row.integrationType, query.target)
      ? await db
          .select({ id: integrationEventMappings.id })
          .from(integrationEventMappings)
          .where(
            and(
              eq(integrationEventMappings.integrationId, row.id),
              eq(integrationEventMappings.targetKey, query.target),
            ),
          )
          .limit(1)
      : [];
    if (!channel)
      throw new HTTPException(404, { message: "Channel not found" });
    return {
      type: row.integrationType,
      connection: {
        id: row.id,
        connectedAt: row.connectedAt?.toISOString() ?? null,
      },
      secrets,
      creds,
    };
  },
  call: async (prepared, { query }) => ({
    connection: prepared.connection,
    ...(await withToken(prepared, (secrets) =>
      oauthProvider(prepared.type)!.search!(secrets, query.target, query.query),
    )),
  }),
  failure: (called) => called.failure,
  handler: async ({ db, called }) => {
    await keepRefreshed(db, called.connection, called.refreshed);
    return { items: (called.data ?? ([] as ExternalItem[])).slice(0, 20) };
  },
});

// One connect route per provider in the registry, in registry order. The path type of a connect route
// names every provider, so the first mount types all of them for the client.
const [firstType, ...otherTypes] = oauthTypes;
const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...saveCredentials)
  .openapi(...getCredentials)
  .openapi(...deleteCredentials)
  .openapi(...startConnect(firstType));
for (const type of otherTypes) router.openapi(...startConnect(type));

export default router.openapi(...listDestinations).openapi(...searchItems);

/** The signed OAuth callback, mounted from quills/public.ts. */
export const oauthCallback = apiRouter().openapi(...callback);
