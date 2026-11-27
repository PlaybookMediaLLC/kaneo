import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { verifyIdentityToken, widgetEnabled } from "../framework/audience";
import {
  attributeClaims,
  claimedAttributes,
  previewClaimedCompany,
  previewClaimedSegments,
  type IdentifyWarning,
} from "./identify-claims";
import { parseCoreIdentityClaims } from "./identify-customer";

// Read-only dry-run verification of a host-signed ssoToken. Host developers, CI checks and AI
// install agents use it to verify their JWT signer and workspace attribute/segment mapping
// without creating test customers, principals or widget sessions.

const verifyToken = defineQuillsRoute({
  audience: "widget",
  signIn: false,
  method: "post",
  path: "/widget/verify-token",
  operationId: "verifyQuillsWidgetToken",
  summary: "Verify a host-signed widget identity token without creating a user",
  description:
    "Dry-run check for a host app's HS256 ssoToken. Validates signature, expiry, required claims (sub and email) and optional attributes, manual segments and company claims without creating a customer or session.",
  action: "read",
  rateLimit: { limit: 30, windowSeconds: 15 * 60 },
  body: z.object({
    ssoToken: z.string().min(1).max(8192),
  }),
  response: z.object({
    valid: z.literal(true),
    claims: z.object({
      sub: z.string(),
      email: z.string(),
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      attributes: z.array(
        z.object({
          key: z.string(),
          value: z.union([z.string(), z.number(), z.boolean()]),
        }),
      ),
      segments: z.array(z.string()),
      company: z
        .object({
          id: z.string(),
          name: z.string(),
          domain: z.string().nullable(),
        })
        .nullable(),
    }),
    warnings: z.array(
      z.object({
        code: z.enum([
          "ATTRIBUTE_IGNORED",
          "SEGMENT_IGNORED",
          "COMPANY_IGNORED",
          "COMPANY_DOMAIN_IGNORED",
        ]),
        field: z.string(),
      }),
    ),
  }),
  responseDescription: "The verified token claims and any non-fatal warnings",
  errors: {
    403: "Widget disabled, identify not configured, or invalid/expired token",
  },
  event: {
    none: "Read-only dry-run token verification creates no database rows.",
  },
  handler: async ({ db, body }) => {
    const [config] = await db
      .select({
        widgetConfig: settings.widgetConfig,
        widgetSecret: settings.widgetSecret,
      })
      .from(settings)
      .limit(1);
    if (!widgetEnabled(config?.widgetConfig ?? null))
      throw new HTTPException(403, { message: "Widget is not enabled" });
    if (!config?.widgetSecret)
      throw new HTTPException(403, {
        message: "Widget identify is not configured",
      });
    const raw = verifyIdentityToken(body.ssoToken, config.widgetSecret);
    if (!raw)
      throw new HTTPException(403, { message: "Invalid or expired ssoToken" });

    const core = parseCoreIdentityClaims(raw);

    const warnings: IdentifyWarning[] = [];
    const { set: attributes, ignored: ignoredAttributes } =
      await claimedAttributes(db, attributeClaims(raw));
    for (const field of ignoredAttributes)
      warnings.push({ code: "ATTRIBUTE_IGNORED", field });

    const { applied: appliedSegments, ignored: ignoredSegments } =
      await previewClaimedSegments(db, raw.segments);
    for (const slug of ignoredSegments)
      warnings.push({ code: "SEGMENT_IGNORED", field: `segments:${slug}` });

    const { company, warnings: companyWarnings } = await previewClaimedCompany(
      db,
      raw.companies,
    );
    warnings.push(...companyWarnings);

    return {
      valid: true as const,
      claims: {
        sub: core.sub,
        email: core.email,
        name: core.name ?? null,
        avatarUrl: core.avatarUrl ?? null,
        attributes: Object.entries(attributes).map(([key, value]) => ({
          key,
          value,
        })),
        segments: appliedSegments,
        company,
      },
      warnings,
    };
  },
});

export default apiRouter().openapi(...verifyToken);
