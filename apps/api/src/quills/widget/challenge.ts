import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import {
  CHALLENGE_PROVIDERS,
  mintPowChallenge,
  parseWidgetAntiSpam,
} from "../framework/anti-spam";
import { widgetEnabled } from "../framework/audience";
import { defineQuillsRoute } from "../framework/define-route";

// Issues a short-lived anti-spam challenge for the widget (#320). Self-hosted deployments default
// to stateless HMAC-signed SHA-256 Proof-of-Work; workspaces may alternatively configure Turnstile.

const requestChallenge = defineQuillsRoute({
  audience: "public",
  method: "post",
  path: "/widget/challenge",
  operationId: "createQuillsWidgetChallenge",
  summary: "Issue an anti-spam challenge for the widget",
  description:
    "Returns a stateless SHA-256 Proof-of-Work challenge (or Turnstile site key when configured) bound to the workspace and client IP.",
  action: "create",
  rateLimit: { limit: 60, windowSeconds: 600 },
  response: z.object({
    provider: z.enum(CHALLENGE_PROVIDERS),
    token: z.string().nullable(),
    difficulty: z.number().int().nullable(),
    expiresAt: z.string().nullable(),
    siteKey: z.string().nullable(),
  }),
  allowKeys: ["token"],
  responseDescription: "The anti-spam challenge to solve",
  errors: { 404: "Widget off" },
  event: {
    none: "Stateless anti-spam challenge issuance writes no workspace state",
  },
  handler: async ({ db, workspaceId, request }) => {
    const [row] = await db
      .select({ widgetConfig: settings.widgetConfig })
      .from(settings)
      .limit(1);
    if (!row || !widgetEnabled(row.widgetConfig)) {
      throw new HTTPException(404, { message: "Workspace not found" });
    }
    const antiSpam = parseWidgetAntiSpam(row.widgetConfig);
    if (antiSpam.challengeProvider === "turnstile") {
      return {
        provider: "turnstile" as const,
        token: null,
        difficulty: null,
        expiresAt: null,
        siteKey: process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ?? null,
      };
    }
    const pow = mintPowChallenge(workspaceId, request.ip);
    return {
      provider: "pow" as const,
      token: pow.token,
      difficulty: pow.difficulty,
      expiresAt: pow.expiresAt,
      siteKey: null,
    };
  },
});

export default apiRouter().openapi(...requestChallenge);
