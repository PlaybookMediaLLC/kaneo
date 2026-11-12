import { desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { createId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { apps } from "../../database/quills/schema/apps";
import { appCapabilities, appKeyScope } from "../framework/app";
import {
  deleteAppKey,
  mintAppKey,
  setAppKeyScope,
} from "../framework/app-keys";
import { defineQuillsRoute } from "../framework/define-route";

// Teammate routes that register a sidebar app and bind it to a new API key (RFC 0001, D13 and D14).

const app = z.object({
  id: z.string(),
  name: z.string(),
  grantedScopes: z.array(z.string()),
  status: z.string(),
  apiKeyId: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
const columns = {
  id: apps.id,
  name: apps.name,
  grantedScopes: apps.grantedScopes,
  status: apps.status,
  apiKeyId: apps.apiKeyId,
  createdAt: apps.createdAt,
  updatedAt: apps.updatedAt,
};
const name = z.string().trim().min(1).max(100);
const scopes = z
  .array(z.enum(appCapabilities))
  .min(1)
  .max(appCapabilities.length)
  .transform((value) => [...new Set(value)]);
const notFound = () => new HTTPException(404, { message: "App not found" });

const listApps = defineQuillsRoute({
  method: "get",
  path: "/app-registrations",
  operationId: "listQuillsAppRegistrations",
  summary: "List the workspace's sidebar apps",
  description:
    "Newest first. An app with no `apiKeyId` was imported and cannot call the app routes.",
  action: "manage_settings",
  query: z.object({
    offset: pagingNumber(0, 1000000, 0),
    limit: pagingNumber(1, 100, 50),
  }),
  response: z.object({
    items: z.array(app),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of apps",
  handler: async ({ db, query }) => {
    const rows = await db
      .select(columns)
      .from(apps)
      .orderBy(desc(apps.createdAt), desc(apps.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    return {
      items: rows.slice(0, query.limit),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

const createApp = defineQuillsRoute({
  method: "post",
  path: "/app-registrations",
  operationId: "createQuillsAppRegistration",
  summary: "Register a sidebar app and create its API key",
  description:
    "Needs a user session, as API key management does. Creates an API key for the caller with workspace:read and the Quills actions that the scopes need, and binds it to the new app. The caller must hold those actions. `secret` is the key: it is shown only in this response. In this workspace's Quills API the key works only on the app routes; it keeps workspace:read on the other platform routes, and its scope in the caller's other workspaces.",
  action: "manage_settings",
  // A key must not mint a key that outlives it.
  sessionOnly: true,
  // Registration also needs quills:read; the scopes' actions are checked against the caller's own.
  alsoRequires: ["read"],
  callerActions: true,
  body: z.object({ name, grantedScopes: scopes }),
  response: app.extend({ secret: z.string() }),
  responseDescription: "The app and its API key, shown once",
  allowKeys: ["secret"],
  event: (_input, result) => ({
    type: "app.registered",
    entityType: "app",
    entityId: result.id,
    payload: {
      apiKeyId: result.apiKeyId ?? "",
      grantedScopes: result.grantedScopes.join(","),
    },
  }),
  prepare: async ({ actor, actions, body }) => ({
    userId: actor.userId,
    name: body.name,
    permissions: appKeyScope(actions, body.grantedScopes),
  }),
  // The key and the app row are in two stores: mint first, bind in the handler, and delete
  // the key when the binding does not commit. The secret leaves only with a committed app.
  call: (prepared) => mintAppKey(prepared),
  revert: (key) => deleteAppKey(key.id),
  handler: async ({ db, body, called: key }) => {
    const [row] = await db
      .insert(apps)
      .values({
        id: createId("app"),
        name: body.name,
        apiKeyId: key.id,
        grantedScopes: body.grantedScopes,
      })
      .returning(columns);
    return { ...row!, secret: key.secret };
  },
});

const updateApp = defineQuillsRoute({
  method: "patch",
  path: "/app-registrations/{appId}",
  operationId: "updateQuillsAppRegistration",
  summary: "Rename, rescope, disable or enable a sidebar app",
  description:
    "Needs a user session. A disabled app's key is refused at once on the app routes and stays refused on this workspace's other Quills routes. The key itself stays enabled: delete it in the API key settings to revoke it everywhere. New scopes also set the key's scope; the caller must hold their Quills actions.",
  action: "manage_settings",
  // It changes an API key's scope.
  sessionOnly: true,
  callerActions: true,
  params: z.object({ appId: flexibleToTypeIdSchema("app") }),
  body: z
    .object({
      name: name.optional(),
      grantedScopes: scopes.optional(),
      status: z.enum(["active", "disabled"]).optional(),
    })
    .refine((value) => Object.values(value).some((v) => v !== undefined), {
      message: "Provide at least one field",
    }),
  response: app,
  responseDescription: "The updated app",
  errors: { 404: "App not found" },
  event: ({ params, body }) => ({
    type: "app.updated",
    entityType: "app",
    entityId: params.appId,
    payload: {
      fields: Object.entries(body)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
        .join(","),
    },
  }),
  prepare: async ({ db, params, body, actions }) => {
    const [row] = await db
      .select({ apiKeyId: apps.apiKeyId })
      .from(apps)
      .where(eq(apps.id, params.appId));
    if (!row) throw notFound();
    if (!body.grantedScopes || !row.apiKeyId) return null;
    return {
      apiKeyId: row.apiKeyId,
      permissions: appKeyScope(actions, body.grantedScopes),
    };
  },
  // Set the key's scope before the app row. An app route of this workspace needs both, so a
  // failure between the two steps leaves the narrower of the old and new scopes in force here.
  call: async (scope) => {
    if (scope) await setAppKeyScope(scope.apiKeyId, scope.permissions);
  },
  handler: async ({ db, params, body }) => {
    const [row] = await db
      .update(apps)
      .set({
        name: body.name,
        grantedScopes: body.grantedScopes,
        status: body.status,
        updatedAt: new Date(),
      })
      .where(eq(apps.id, params.appId))
      .returning(columns);
    if (!row) throw notFound();
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listApps)
  .openapi(...createApp)
  .openapi(...updateApp);
