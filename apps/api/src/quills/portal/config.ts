import { apiRouter, z } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { bool, parseJson, record } from "../settings/area";

// The portal configuration that anyone may read. The access policy (allowed domains and
// segments) stays server-side; only "is the portal private" leaves.

const portalConfig = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/portal/config",
  operationId: "getQuillsPublicPortalConfig",
  summary: "Get the public portal configuration",
  description:
    "Sign-in uses the existing Kaneo account endpoints under /api/auth; portal customers need no workspace membership.",
  action: "read",
  response: z.object({
    name: z.string(),
    features: z.object({
      allowAnonymous: z.boolean(),
      allowEditAfterEngagement: z.boolean(),
      allowDeleteAfterEngagement: z.boolean(),
      showPublicEditHistory: z.boolean(),
    }),
    portalAccess: z.object({ isPrivate: z.boolean() }),
  }),
  responseDescription: "The public portal configuration",
  handler: async ({ db }) => {
    const [row] = await db
      .select({ name: settings.name, portalConfig: settings.portalConfig })
      .from(settings)
      .limit(1);
    const config = parseJson(row?.portalConfig ?? null);
    const features = record(config.features);
    return {
      name: row?.name ?? "",
      features: {
        // A missing flag denies anonymous interaction.
        allowAnonymous: features.allowAnonymous === true,
        allowEditAfterEngagement: bool(
          features.allowEditAfterEngagement,
          false,
        ),
        allowDeleteAfterEngagement: bool(
          features.allowDeleteAfterEngagement,
          false,
        ),
        showPublicEditHistory: bool(features.showPublicEditHistory, false),
      },
      portalAccess: {
        isPrivate: record(config.access).visibility === "private",
      },
    };
  },
});

export default apiRouter().openapi(...portalConfig);
