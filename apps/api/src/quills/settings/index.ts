import { apiRouter, z, type BaseVariables } from "../../openapi";
import { settings } from "../../database/quills/schema/auth";
import { defineQuillsRoute } from "../framework/define-route";
import { parseJson } from "./area";
import branding from "./branding";
import developer from "./developer";
import labs, { resolveFlags } from "./labs";
import portal from "./portal";
import widget from "./widget";

const overview = defineQuillsRoute({
  method: "get",
  path: "/settings",
  operationId: "listQuillsSettings",
  summary: "Get the workspace settings overview",
  description:
    "The name and slug belong to the workspace and are read-only here. Secrets are never included; each area has its own route.",
  action: "read",
  response: z.object({
    name: z.string(),
    slug: z.string(),
    modules: z.object({
      feedback: z.boolean(),
      changelog: z.boolean(),
      helpCenter: z.boolean(),
      supportInbox: z.boolean(),
      supportTickets: z.boolean(),
      statusPage: z.boolean(),
    }),
    areas: z.array(z.string()),
  }),
  responseDescription: "Settings overview",
  handler: async ({ db }) => {
    const [row] = await db
      .select({
        name: settings.name,
        slug: settings.slug,
        featureFlags: settings.featureFlags,
      })
      .from(settings)
      .limit(1);
    if (!row) throw new Error("Quills settings were not initialized");
    return {
      name: row.name,
      slug: row.slug,
      modules: resolveFlags(parseJson(row.featureFlags)),
      areas: ["portal", "branding", "widget", "developer", "labs"],
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...overview)
  .route("/", portal)
  .route("/", branding)
  .route("/", widget)
  .route("/", developer)
  .route("/", labs);
