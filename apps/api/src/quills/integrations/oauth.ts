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
  beforeDeadline,
  credentialText,
  openCredentials,
  sealCredentials,
} from "../framework/integration-config";
import {
  mintOAuthState,
  oauthBridge,
  oauthState,
  unauthorized,
  type Located,
  type SignedVerifier,
} from "../framework/signed";
import { oauthFailureOutcome, oauthResultUrl } from "../framework/oauth-result";
import { bridgePage, bridgeScripts, usedPage } from "./oauth-bridge";
import {
  connect,
  connectedEvent,
  integrationParams,
  integrationSummary,
  summaryColumns,
} from "./connect";
import {
  connectQuery,
  failureOf,
  providerFailure,
  redirectUri,
  signedUrl,
  tokenFields,
  type Destination,
  type DestinationScope,
  type Exchanged,
  type ExternalItem,
  type OAuthProvider,
} from "./oauth-providers";
import {
  freshSecrets,
  oauthApp,
  oauthProvider,
  oauthTypes,
  validTarget,
  type OAuthProviderType,
} from "./providers";

// OAuth connections (the providers in providers/). A teammate saves the workspace's OAuth app
// (platform credentials) and starts a connect; the provider redirects the browser to the signed
// callback, which the state binds to that teammate, workspace and provider. Tokens are sealed with
// NOTIFICATION_SECRET_ENCRYPTION_KEY and never returned. Every provider call runs with no database
// transaction open: read, release, call, then write in a new scoped transaction.

type Types = [OAuthProviderType, ...OAuthProviderType[]];
/** A provider that returns a token in the URL fragment (Trello) completes through the bridge page. */
const fragment = (type: OAuthProviderType) =>
  oauthApp(type).callback === "fragment";
// The code callback never takes a fragment provider's token: that path has no Origin check.
const typeParams = z.object({
  type: z.enum(oauthTypes.filter((type) => !fragment(type)) as Types),
});
const fragmentParams = z.object({
  type: z.enum(oauthTypes.filter(fragment) as Types),
});
/** Where the provider sends the browser back: the signed callback, or the bridge page. */
const returnUri = (type: OAuthProviderType) =>
  fragment(type) ? signedUrl(`/oauth/${type}/bridge`) : redirectUri(type);
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
    "A provider whose bot posts messages (Discord) also needs the bot token. Slack takes the app's signing secret for the assistant's event hook: a save without `signingSecret` keeps the stored one, and an empty value or null removes it. Secrets are stored encrypted and never returned. Register the returned redirect URI in the provider app.",
  action: "manage_settings",
  body: typeQuery.extend({
    // Nested: the OAuth client ID is a provider value, not an ID in this workspace.
    client: z.object({ id: credentialValue, secret: credentialValue }),
    botToken: credentialValue.optional(),
    // Omitted: keep the stored secret. Empty or null: remove it.
    signingSecret: z.union([credentialValue, z.literal("")]).nullish(),
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
    // The row lock keeps a concurrent save of a saved row from losing the secret that this save keeps.
    // ponytail: a first save that races another first save has no row to lock and can drop the
    // other's secret; take an advisory lock on (workspace, type) if that race matters.
    const [stored] =
      body.signingSecret === undefined
        ? await db
            .select({ secrets: platform.secrets })
            .from(platform)
            .where(eq(platform.integrationType, body.type))
            .for("update")
        : [];
    const signingSecret =
      body.signingSecret === undefined
        ? stored && openCredentials(stored.secrets)?.signingSecret
        : body.signingSecret;
    const secrets = sealCredentials({
      clientId: body.client.id,
      clientSecret: body.client.secret,
      ...(body.botToken && { botToken: body.botToken }),
      ...(signingSecret && { signingSecret }),
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
      redirectUri: returnUri(body.type),
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
      redirectUri: returnUri(query.type),
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

/** The provider's authorization URL, with a signed state that carries the connect fields. */
async function authorization(
  db: Database,
  actor: { workspaceId: string; userId: string },
  type: (typeof oauthTypes)[number],
  fields: Record<string, string>,
) {
  const creds = await appCredentials(db, type);
  if (!creds?.clientId) throw notConfigured();
  const state = mintOAuthState({
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    type,
    fields,
  });
  return {
    authorizeUrl: oauthApp(type).authorizeUrl(
      creds,
      returnUri(type),
      state,
      fields,
    ),
  };
}
const connectRoute = (type: (typeof oauthTypes)[number]) =>
  ({
    method: "get",
    path: `/oauth/${type}/connect`,
    operationId: `startQuills${type[0]!.toUpperCase()}${type.slice(1)}OAuthConnect`,
    summary: `Start the ${oauthProvider(type)!.name} OAuth connection`,
    description:
      "Returns the provider's authorization URL. Open it in the same browser session: the state expires after ten minutes, is bound to the caller and this workspace, and works once.",
    action: "manage_settings",
    response: z.object({ authorizeUrl: z.string() }),
    responseDescription: "The provider authorization URL",
  }) as const;

/** One connect route per provider, at the source's path: the provider is part of the path, not an input. */
const startConnect = (type: (typeof oauthTypes)[number]) =>
  defineQuillsRoute({
    ...connectRoute(type),
    errors: { 403: "Insufficient permission", 409: "No OAuth app credentials" },
    handler: ({ db, actor }) => authorization(db, actor, type, {}),
  });
/** The connect route of a provider with connect fields: they are query values, and the state carries them. */
const startConnectWithFields = (
  type: (typeof oauthTypes)[number],
  fields: Record<string, RegExp>,
) =>
  defineQuillsRoute({
    ...connectRoute(type),
    query: connectQuery(fields),
    errors: {
      400: "A connect field is missing or not valid",
      403: "Insufficient permission",
      409: "No OAuth app credentials",
    },
    handler: ({ db, actor, query }) => authorization(db, actor, type, query),
  });

/** The connect fields of a verified state, checked again against the provider's patterns. 400 otherwise. */
function stateFields(type: (typeof oauthTypes)[number], claim?: string) {
  const parsed = connectQuery(oauthApp(type).connectFields ?? {})
    .strict()
    .safeParse(claim ? JSON.parse(claim) : {});
  if (!parsed.success)
    throw new HTTPException(400, {
      message: "The connect fields are not valid.",
    });
  return parsed.data;
}

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
/** Both callbacks, after the exchange: seal the tokens and connect as the teammate who started it. */
const completion = {
  replay: { status: "already_used", integration: null },
  redirect: {
    success: (
      result: z.output<typeof callbackResult>,
      { params }: { params: { type: OAuthProviderType } },
    ) =>
      oauthResultUrl(
        result.status,
        oauthProvider(params.type)?.name ?? "Integration",
      ),
    failure: (
      status: number,
      { params }: { params: { type: OAuthProviderType } },
    ) =>
      oauthResultUrl(
        oauthFailureOutcome(status),
        oauthProvider(params.type)?.name ?? "Integration",
      ),
  },
  event: (input: unknown, result: z.output<typeof callbackResult>) =>
    result.integration
      ? connectedEvent(input, { integration: result.integration })
      : false,
  // The audit row names the teammate who started the connect.
  actor: (db: Database, located: Located) =>
    teammate(db, located.claims?.userId ?? ""),
} as const;
async function connectAs({
  db,
  params,
  located,
  called,
  workspaceId,
}: {
  db: Database;
  params: { type: OAuthProviderType };
  located: Located;
  called: Exchanged;
  workspaceId: string;
}) {
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
}
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
  prepare: async ({ db, params, query, located }) => {
    if (!query.code)
      throw new HTTPException(400, {
        message: "The provider did not grant access.",
      });
    const fields = stateFields(params.type, located.claims?.fields);
    const creds = await appCredentials(db, params.type);
    if (!creds?.clientId || !creds.clientSecret) throw notConfigured();
    return { creds, code: query.code, fields };
  },
  call: ({ creds, code, fields }, { params }) =>
    oauthApp(params.type)
      .exchange(code, redirectUri(params.type), creds, fields)
      .catch(providerFailure),
  ...completion,
  handler: (input) => connectAs(input),
});

/**
 * The token post checks and uses up the state as the code callback does (the same receipts). A
 * browser sends `Origin` with every POST: it must be this API's origin, and `Sec-Fetch-Site`, when
 * sent, must be same-origin. So only the bridge page of this instance can post a token into the
 * session. 401 otherwise, before any database access.
 */
const fragmentState: SignedVerifier = {
  ...oauthState,
  locate: (request) => {
    const site = request.headers.get("sec-fetch-site");
    if (
      request.headers.get("origin") !== new URL(signedUrl("")).origin ||
      (site !== null && site !== "same-origin")
    )
      throw unauthorized();
    return oauthState.locate(request);
  },
};
const stateQuery = z.object({ state: z.string().min(1).max(2048) });

const bridge = defineQuillsRoute({
  audience: "signed",
  verifier: oauthBridge,
  method: "get",
  path: "/oauth/{type}/bridge",
  operationId: "openQuillsOAuthBridge",
  summary: "Open the bridge page of an OAuth connection with a fragment token",
  description:
    "Trello sends the browser here with the token in the URL fragment, which no server receives. The page removes the fragment, then posts the token to `completeQuillsOAuthFragmentConnect` with the same state, which checks the session, the permission and the expiry. The page needs a state that this instance signed for this provider. It opens once for each state, and opening it does not use the state up.",
  action: "manage_settings",
  params: fragmentParams,
  query: stateQuery,
  raw: "text/html",
  scripts: bridgeScripts,
  response: z.string(),
  responseDescription: "The bridge page",
  replay: usedPage,
  event: { none: "The page changes nothing; the callback connects." },
  handler: async () => bridgePage,
});

const fragmentCallback = defineQuillsRoute({
  audience: "signed",
  verifier: fragmentState,
  method: "post",
  path: "/oauth/{type}/callback",
  operationId: "completeQuillsOAuthFragmentConnect",
  summary: "Complete an OAuth connection with a token from the URL fragment",
  description:
    'The bridge page posts the JSON body `{ "token": "…" }` (at most 2,048 characters) here. `Origin` must be this API\'s origin. The signed state in the query must be unexpired, unused, for this provider and for the signed-in account, which must still hold quills:manage_settings in the state\'s workspace. The provider checks the token before it is stored; it is never returned.',
  action: "manage_settings",
  params: fragmentParams,
  query: stateQuery,
  body: z.object({ token: z.string().min(1).max(2048) }),
  response: callbackResult,
  responseDescription: "The connection without its tokens",
  errors: {
    400: "The body is not a valid token, or the provider rejected the token",
    403: "The account no longer manages Quills settings",
    409: "No OAuth app credentials, or the provider rejected the credentials",
    502: "The provider could not be reached",
  },
  prepare: async ({ db, params, body, located }) => {
    const fields = stateFields(params.type, located.claims?.fields);
    const creds = await appCredentials(db, params.type);
    if (!creds?.clientId) throw notConfigured();
    return { creds, token: body.token, fields };
  },
  call: ({ creds, token, fields }, { params }) =>
    oauthApp(params.type)
      .exchange(token, returnUri(params.type), creds, fields)
      .catch(providerFailure),
  ...completion,
  handler: (input) => connectAs(input),
});

/**
 * A connection of this provider family with its secrets, for a provider call. 404 otherwise. A route
 * module of a provider capability (for example contact lookup) uses this, withToken and keepRefreshed.
 */
export async function oauthConnection(
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
 * With `signal`, the refresh and then `work` each stop waiting when it aborts (a fixed 502). A refresh
 * that finished first is kept; one that did not finish changes nothing. `work` gets the same signal
 * from its caller and passes it to each provider request.
 */
export async function withToken<T>(
  prepared: {
    type: string;
    secrets: Record<string, string>;
    creds: Record<string, string>;
  },
  work: (secrets: Record<string, string>) => Promise<T>,
  signal?: AbortSignal,
) {
  let refreshed: Record<string, string> | null = null;
  try {
    const fresh = await beforeDeadline(
      freshSecrets(prepared.type, prepared.secrets, prepared.creds, signal),
      signal,
    );
    refreshed = fresh.refreshed;
    return {
      data: await beforeDeadline(work(fresh.secrets), signal),
      refreshed,
      failure: null,
    };
  } catch (error) {
    return { data: null, refreshed, failure: failureOf(error) };
  }
}

/** The destination kind and parent of a request, checked against the provider's kinds. 400 otherwise. */
function destinationScope(
  provider: OAuthProvider,
  query: DestinationScope,
): DestinationScope {
  const kinds = provider.destinationKinds ?? {};
  if (query.kind !== undefined && !Object.hasOwn(kinds, query.kind))
    throw new HTTPException(400, {
      message: "This integration has no destinations of that kind.",
    });
  const parentKind = query.kind && kinds[query.kind]?.parent;
  if (Boolean(parentKind) !== (query.parent !== undefined))
    throw new HTTPException(400, {
      message: parentKind
        ? "Name the parent destination."
        : "This kind of destination has no parent.",
    });
  return { kind: query.kind, parent: query.parent };
}

const listDestinations = defineQuillsRoute({
  method: "get",
  path: "/integrations/{integrationId}/destinations",
  operationId: "listQuillsIntegrationDestinations",
  summary: "List the channels an OAuth connection can send to",
  description:
    "The provider's destinations (for example repositories, projects or channels), at most 200. A provider with more than one kind takes `kind`; a child kind also takes `parent`, which must be a destination of the parent kind. Calls the provider.",
  action: "manage_settings",
  params: integrationParams,
  query: z.object({
    kind: z
      .string()
      .max(40)
      .regex(/^[a-z][a-z0-9_-]*$/)
      .optional(),
    // A provider ID or name (an Azure DevOps project name has spaces). The route checks it against the parent list.
    parent: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^/\\?#%]+$/)
      .refine((value) => !/\p{Cc}/u.test(value), "No control characters")
      .optional(),
  }),
  response: z.object({
    destinations: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
  responseDescription: "Destinations, in the provider's order",
  errors: {
    400: "Unknown kind, or a missing or unexpected parent",
    403: "Insufficient permission",
    404: "Integration or parent destination not found",
    409: "Reconnect the integration",
    502: "The provider could not be reached",
  },
  prepare: async ({ db, params, query }) => {
    const { row, provider, secrets, creds } = await oauthConnection(
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
      scope: destinationScope(provider, query),
    };
  },
  call: async (prepared) => ({
    connection: prepared.connection,
    ...(await withToken(prepared, async (secrets) => {
      const provider = oauthProvider(prepared.type)!;
      const { kind, parent } = prepared.scope;
      const parentKind = kind && provider.destinationKinds?.[kind]?.parent;
      // The parent must be one the integration lists: the token may reach far more.
      if (
        parentKind &&
        !(
          await provider.destinations(
            secrets,
            prepared.config,
            prepared.creds,
            {
              kind: parentKind,
            },
          )
        ).some((destination) => destination.id === parent)
      )
        throw new HTTPException(404, {
          message: "Parent destination not found",
        });
      return provider.destinations(
        secrets,
        prepared.config,
        prepared.creds,
        prepared.scope,
      );
    })),
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
    "At most 20 results, only in a repository or project that is one of the integration's channels. Search qualifiers are ignored. Calls the provider. Only for a provider with item search; 409 otherwise.",
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
// names every provider, so the first mount types all of them for the client. The client type has no
// connect fields: a client adds them as query values. The first provider (GitHub) has none.
const [firstType, ...otherTypes] = oauthTypes;
if (oauthApp(firstType).connectFields)
  throw new Error(
    "providers/index.ts: the first provider has no connect fields",
  );
const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...saveCredentials)
  .openapi(...getCredentials)
  .openapi(...deleteCredentials)
  .openapi(...startConnect(firstType));
for (const type of otherTypes) {
  const fields = oauthApp(type).connectFields;
  if (fields) router.openapi(...startConnectWithFields(type, fields));
  else router.openapi(...startConnect(type));
}

export default router.openapi(...listDestinations).openapi(...searchItems);

/** The signed OAuth callbacks and the bridge page, mounted from quills/public.ts. */
export const oauthCallback = apiRouter()
  .openapi(...callback)
  .openapi(...bridge)
  .openapi(...fragmentCallback);
