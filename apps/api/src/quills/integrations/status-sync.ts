import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { integrations } from "../../database/quills/schema/integrations";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  openCredentials,
  ProviderCallError,
  providerJson,
  sealCredentials,
} from "../framework/integration-config";
import { newSigningSecret } from "../framework/webhook-config";
import { integrationParams } from "./connect";
import { appCredentials, keepRefreshed } from "./oauth";
import {
  failureOf,
  githubRepo,
  signedUrl,
  tokenFields,
} from "./oauth-providers";
import { freshSecrets, oauthProvider, validTarget } from "./providers";

// Status sync (P6 rows moved here): an issue that closes or reopens in GitHub or GitLab changes the
// linked post's status through the teammate's mappings. Enabling registers a webhook in the provider
// with a fresh secret that never leaves the server; the signed route integrations/inbound.ts checks it.

type IntegrationId = z.output<typeof integrationParams>["integrationId"];
type StatusSync = {
  target: string;
  hookId: string | null;
  /** `uncertain`: the provider did not answer the registration; it may have created the webhook. */
  state: "active" | "uncertain";
};
const statusSyncView = z
  .object({
    enabled: z.boolean(),
    target: z.string().nullable(),
    state: z.enum(["active", "uncertain"]).nullable(),
    webhookUrl: z.string(),
  })
  .openapi("QuillsStatusSync");
const target = z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/);
const mappingList = z.array(
  z.object({ externalStatus: z.string(), statusId: z.string().nullable() }),
);
const listOf = (mappings: unknown) =>
  Object.entries((mappings ?? {}) as Record<string, string | null>).map(
    ([externalStatus, statusId]) => ({ externalStatus, statusId }),
  );
const errors = {
  403: "Insufficient permission",
  404: "Integration not found",
  409: "This integration has no status sync, or it must be reconnected",
  502: "The provider could not be reached",
} as const;

const webhookUrl = (type: string, id: string) =>
  signedUrl(`/integrations/${type}/${id}/webhook`);
const syncOf = (config: Record<string, unknown>) =>
  (config.statusSync ?? null) as StatusSync | null;
const view = (type: string, id: string, config: Record<string, unknown>) => {
  const sync = syncOf(config);
  return {
    enabled: Boolean(sync),
    target: sync?.target ?? null,
    state: sync?.state ?? null,
    webhookUrl: webhookUrl(type, id),
  };
};

/** A live connection whose provider reports issue statuses. 404 or 409 otherwise. A write locks the row. */
async function syncable(db: Database, id: IntegrationId, lock = true) {
  const query = db
    .select({
      id: integrations.id,
      type: integrations.integrationType,
      config: integrations.config,
      secrets: integrations.secrets,
      connectedAt: integrations.connectedAt,
    })
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.status, "active")));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new HTTPException(404, { message: "Integration not found" });
  const provider = oauthProvider(row.type);
  if (!provider?.statuses.length)
    throw new HTTPException(409, {
      message: "This integration has no status sync.",
    });
  return { row, provider, config: row.config as Record<string, unknown> };
}

const getStatusSync = defineQuillsRoute({
  method: "get",
  path: "/integrations/{integrationId}/status-sync",
  operationId: "getQuillsStatusSync",
  summary: "Get an integration's status sync, external statuses and mappings",
  action: "manage_settings",
  params: integrationParams,
  response: z.object({
    statusSync: statusSyncView,
    externalStatuses: z.array(z.string()),
    mappings: mappingList,
  }),
  responseDescription: "Status sync settings",
  errors,
  handler: async ({ db, params }) => {
    const { row, provider, config } = await syncable(
      db,
      params.integrationId,
      false,
    );
    return {
      statusSync: view(row.type, row.id, config),
      externalStatuses: [...provider.statuses],
      mappings: listOf(config.statusMappings),
    };
  },
});

/**
 * Registers the webhook. A provider that did not answer, or answered 5xx, may have created it:
 * recorded as uncertain and never registered again automatically.
 */
async function register(
  type: string,
  token: string,
  repo: string,
  url: string,
  secret: string,
): Promise<{ hookId: string | null; state: StatusSync["state"] }> {
  try {
    const hook = (
      type === "github"
        ? await providerJson(
            `https://api.github.com/repos/${githubRepo(repo)}/hooks`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                accept: "application/vnd.github+json",
                "content-type": "application/json",
                "user-agent": "Quills",
              },
              body: JSON.stringify({
                name: "web",
                active: true,
                events: ["issues"],
                config: {
                  url,
                  content_type: "json",
                  secret,
                  insecure_ssl: "0",
                },
              }),
            },
          )
        : await providerJson(
            `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}/hooks`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                url,
                token: secret,
                issues_events: true,
                push_events: false,
                enable_ssl_verification: true,
              }),
            },
          )
    ) as { id?: unknown } | null;
    return {
      hookId: hook?.id === undefined ? null : String(hook.id),
      state: "active",
    };
  } catch (error) {
    if (
      error instanceof ProviderCallError &&
      (error.status === null || error.status >= 500)
    )
      return { hookId: null, state: "uncertain" };
    if (error instanceof ProviderCallError && error.status === 422)
      throw new HTTPException(409, {
        message:
          "The provider already has this webhook. Remove it there, then enable status sync again.",
      });
    throw error;
  }
}

const enableStatusSync = defineQuillsRoute({
  method: "post",
  path: "/integrations/{integrationId}/status-sync",
  operationId: "enableQuillsStatusSync",
  summary: "Enable status sync for a repository or project",
  description:
    "Registers an issues webhook in the provider with a new secret that is never returned. A provider that does not answer leaves the state `uncertain`: check its webhook list before enabling again.",
  action: "manage_settings",
  params: integrationParams,
  body: z.object({ target }),
  response: z.object({ statusSync: statusSyncView, changed: z.boolean() }),
  responseDescription: "The status sync",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "integration.status_sync_enabled",
      entityType: "integration",
      entityId: params.integrationId,
    },
  prepare: async ({ db, params, body }) => {
    const { row } = await syncable(db, params.integrationId, false);
    if (!validTarget(row.type, body.target))
      throw new HTTPException(400, {
        message: "Use a repository or project from the destinations list.",
      });
    const secrets = openCredentials(row.secrets);
    if (!secrets?.accessToken)
      throw new HTTPException(409, {
        message: "The saved credentials cannot be read. Reconnect.",
      });
    return {
      type: row.type,
      id: row.id,
      connectedAt: row.connectedAt?.toISOString() ?? null,
      secrets,
      creds: (await appCredentials(db, row.type)) ?? {},
      secret: newSigningSecret().secret,
    };
  },
  call: async (prepared, { body }) => {
    let refreshed: Record<string, string> | null = null;
    try {
      const fresh = await freshSecrets(
        prepared.type,
        prepared.secrets,
        prepared.creds,
      );
      refreshed = fresh.refreshed;
      const hook = await register(
        prepared.type,
        fresh.secrets.accessToken ?? "",
        body.target,
        webhookUrl(prepared.type, prepared.id),
        prepared.secret,
      );
      return { hook, refreshed, failure: null, prepared };
    } catch (error) {
      // A refreshed token is kept even though the registration failed (GitLab rotates it).
      return { hook: null, refreshed, failure: failureOf(error), prepared };
    }
  },
  failure: (called) => called.failure,
  handler: async ({ db, params, body, called }) => {
    const connection = {
      id: params.integrationId,
      connectedAt: called.prepared.connectedAt,
    };
    if (!called.hook) {
      await keepRefreshed(db, connection, called.refreshed);
      const { row, config } = await syncable(db, params.integrationId, false);
      return { statusSync: view(row.type, row.id, config), changed: false };
    }
    const { row, config } = await syncable(db, params.integrationId);
    // A reconnect during the call started a new installation: its secrets are not ours to change.
    if ((row.connectedAt?.toISOString() ?? null) !== connection.connectedAt)
      throw new HTTPException(409, {
        message: "The integration changed. Enable status sync again.",
      });
    const statusSync: StatusSync = {
      target: body.target,
      hookId: called.hook.hookId,
      state: called.hook.state,
    };
    const next = { ...config, statusSync };
    // Merge into the stored secrets: a token refreshed elsewhere during the call stays.
    await db
      .update(integrations)
      .set({
        secrets: sealCredentials({
          ...openCredentials(row.secrets),
          ...(called.refreshed && tokenFields(called.refreshed)),
          webhookSecret: called.prepared.secret,
        }),
        config: next,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, row.id));
    return { statusSync: view(row.type, row.id, next), changed: true };
  },
});

const disableStatusSync = defineQuillsRoute({
  method: "delete",
  path: "/integrations/{integrationId}/status-sync",
  operationId: "disableQuillsStatusSync",
  summary: "Disable status sync",
  description:
    "Removes the webhook secret, so the inbound route rejects later deliveries. Remove the webhook in the provider too.",
  action: "manage_settings",
  params: integrationParams,
  response: z.object({ statusSync: statusSyncView, changed: z.boolean() }),
  responseDescription: "The status sync",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "integration.status_sync_disabled",
      entityType: "integration",
      entityId: params.integrationId,
    },
  handler: async ({ db, params }) => {
    const { row, config } = await syncable(db, params.integrationId);
    if (!syncOf(config))
      return { statusSync: view(row.type, row.id, config), changed: false };
    const { webhookSecret: _removed, ...secrets } =
      openCredentials(row.secrets) ?? {};
    const { statusSync: _off, ...next } = config;
    await db
      .update(integrations)
      .set({
        secrets: sealCredentials(secrets),
        config: next,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, row.id));
    return { statusSync: view(row.type, row.id, next), changed: true };
  },
});

const setMappings = defineQuillsRoute({
  method: "put",
  path: "/integrations/{integrationId}/status-mappings",
  operationId: "updateQuillsStatusMappings",
  summary: "Map external statuses to post statuses",
  description:
    "Keys are the provider's statuses (see getQuillsStatusSync). Null ignores that status.",
  action: "manage_settings",
  params: integrationParams,
  body: z.object({
    mappings: z
      .record(
        z.string().max(64),
        flexibleToTypeIdSchema("post_status").nullable(),
      )
      .refine((value) => Object.keys(value).length <= 20, {
        message: "At most 20 mappings",
      }),
  }),
  response: z.object({ mappings: mappingList }),
  responseDescription: "The saved mappings",
  errors,
  event: ({ params }) => ({
    type: "integration.status_mappings_updated",
    entityType: "integration",
    entityId: params.integrationId,
  }),
  handler: async ({ db, params, body }) => {
    const { row, provider, config } = await syncable(db, params.integrationId);
    const unknown = Object.keys(body.mappings).filter(
      (key) => !provider.statuses.includes(key),
    );
    if (unknown.length)
      throw new HTTPException(400, {
        message: `Unknown external status: ${unknown.join(", ")}`,
      });
    const { mappings } = body;
    const mapped = Object.values(mappings).filter((id) => id !== null);
    const ids = [...new Set(mapped)];
    const found = ids.length
      ? await db
          .select({ id: postStatuses.id })
          .from(postStatuses)
          .where(inArray(postStatuses.id, ids))
      : [];
    if (found.length !== ids.length)
      throw new HTTPException(404, { message: "Status not found" });
    await db
      .update(integrations)
      .set({
        config: { ...config, statusMappings: body.mappings },
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, row.id));
    return { mappings: listOf(body.mappings) };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getStatusSync)
  .openapi(...enableStatusSync)
  .openapi(...disableStatusSync)
  .openapi(...setMappings);
