import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireUserSession } from "../utils/require-user-session";
import { requireInstancePermission } from "./roles/require-instance-permission";
import {
  getOidcProviderConfigView,
  getSmtpProviderConfigView,
  saveOidcProviderConfig,
  saveSmtpProviderConfig,
} from "./providers/provider-config";

const forbidden = errorResponse(
  "The caller lacks the instance:settings permission or used an API key",
);

const smtpConfigSchema = z
  .object({
    configured: z.boolean(),
    lockedByEnv: z.boolean(),
    host: z.string(),
    port: z.number().int(),
    secure: z.boolean(),
    username: z.string(),
    hasPassword: z.boolean(),
    from: z.string(),
  })
  .openapi("AdminSmtpProviderConfig");

const smtpConfigBody = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  username: z.string().trim().max(255).default(""),
  password: z.string().max(512).optional(),
  from: z.string().trim().min(3).max(255),
});

const oidcConfigSchema = z
  .object({
    configured: z.boolean(),
    lockedByEnv: z.boolean(),
    issuer: z.string(),
    clientId: z.string(),
    hasClientSecret: z.boolean(),
    scopes: z.string(),
    groupsClaim: z.string(),
    lockProfileFields: z.boolean(),
  })
  .openapi("AdminOidcProviderConfig");

const oidcConfigBody = z.object({
  issuer: z.string().url().max(512),
  clientId: z.string().trim().min(1).max(255),
  clientSecret: z.string().max(512).optional(),
  scopes: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .default("openid email profile groups"),
  groupsClaim: z.string().trim().min(1).max(100).default("groups"),
  lockProfileFields: z.boolean().default(false),
});

const getSmtpRoute = createRoute({
  method: "get",
  operationId: "getAdminSmtpProviderConfig",
  path: "/smtp",
  tags: ["Admin"],
  summary: "Get instance SMTP provider configuration (secrets redacted)",
  middleware: [
    requireUserSession,
    requireInstancePermission("instance:settings"),
  ] as const,
  responses: {
    200: jsonResponse("SMTP configuration view", smtpConfigSchema),
    403: forbidden,
  },
});

const putSmtpRoute = createRoute({
  method: "put",
  operationId: "updateAdminSmtpProviderConfig",
  path: "/smtp",
  tags: ["Admin"],
  summary: "Save encrypted instance SMTP provider configuration",
  middleware: [
    requireUserSession,
    requireInstancePermission("instance:settings"),
  ] as const,
  request: {
    body: {
      content: { "application/json": { schema: smtpConfigBody } },
      required: true,
    },
  },
  responses: {
    200: jsonResponse("Saved SMTP configuration view", smtpConfigSchema),
    403: forbidden,
    409: errorResponse("SMTP configuration is locked by environment variables"),
  },
});

const getOidcRoute = createRoute({
  method: "get",
  operationId: "getAdminOidcProviderConfig",
  path: "/oidc",
  tags: ["Admin"],
  summary: "Get instance OIDC provider configuration (secrets redacted)",
  middleware: [
    requireUserSession,
    requireInstancePermission("instance:settings"),
  ] as const,
  responses: {
    200: jsonResponse("OIDC configuration view", oidcConfigSchema),
    403: forbidden,
  },
});

const putOidcRoute = createRoute({
  method: "put",
  operationId: "updateAdminOidcProviderConfig",
  path: "/oidc",
  tags: ["Admin"],
  summary: "Save encrypted instance OIDC provider configuration",
  middleware: [
    requireUserSession,
    requireInstancePermission("instance:settings"),
  ] as const,
  request: {
    body: {
      content: { "application/json": { schema: oidcConfigBody } },
      required: true,
    },
  },
  responses: {
    200: jsonResponse("Saved OIDC configuration view", oidcConfigSchema),
    403: forbidden,
    409: errorResponse("OIDC configuration is locked by environment variables"),
  },
});

const adminProviderRoutes = apiRouter()
  .openapi(getSmtpRoute, async (c) =>
    c.json(await getSmtpProviderConfigView(), 200),
  )
  .openapi(putSmtpRoute, async (c) =>
    c.json(
      await saveSmtpProviderConfig(c.req.valid("json"), c.get("userId")),
      200,
    ),
  )
  .openapi(getOidcRoute, async (c) =>
    c.json(await getOidcProviderConfigView(), 200),
  )
  .openapi(putOidcRoute, async (c) =>
    c.json(
      await saveOidcProviderConfig(c.req.valid("json"), c.get("userId")),
      200,
    ),
  );

export default adminProviderRoutes;
