import delivery from "./delivery";
import directory from "./directory/index";
import feedback from "./feedback/core";
import files from "./files/routes";
import jobs from "./jobs/routes";
import links from "./links";
import quillsSettings from "./settings/index";
import sharedTeams from "./teams";
import taxonomy from "./feedback/taxonomy";
import supportConversations from "./support/conversations-router";
import { brandText } from "@kaneo/branding";
import { apiRouter, z, type BaseVariables } from "../openapi";
import { settings } from "../database/quills/schema/auth";
import { defineQuillsRoute } from "./framework/define-route";

const context = defineQuillsRoute({
  method: "get",
  path: "/context",
  operationId: "getQuillsWorkspaceContext",
  summary: "Get the caller's Quills workspace context",
  description: brandText(
    "Uses the existing Kaneo account, workspace membership, roles and API-key scope. Initializes Quills defaults and the caller's actor when needed. Requires workspace:read and quills:read.",
  ),
  action: "read",
  response: z
    .object({
      workspace: z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
      }),
      actor: z.object({
        principalId: z.string(),
        userId: z.string(),
        workspaceId: z.string(),
      }),
    })
    .openapi("QuillsWorkspaceContext"),
  responseDescription: "Workspace and actor for Quills features",
  errors: {
    403: "Workspace archived or insufficient permission or API-key scope",
    404: "Workspace not found",
  },
  allowKeys: ["workspaceId"],
  handler: async ({ db, actor }) => {
    const [workspace] = await db
      .select({ name: settings.name, slug: settings.slug })
      .from(settings);
    if (!workspace) throw new Error("Quills workspace was not initialized");
    return { workspace: { id: actor.workspaceId, ...workspace }, actor };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", files)
  .route("/", jobs)
  .route("/", links)
  .route("/", sharedTeams)
  .route("/", directory)
  .route("/", quillsSettings)
  .route("/", feedback)
  .route("/", delivery)
  .route("/", taxonomy)
  .route("/", supportConversations)
  .openapi(...context);
