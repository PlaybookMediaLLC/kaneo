import apps from "./apps/index";
import agentChannels from "./agent-channels";
import automation from "./automation/index";
import assistant from "./assistant/index";
import content from "./content/index";
import delivery from "./delivery";
import directory from "./directory/index";
import feedback from "./feedback/core";
import files from "./files/routes";
import integrations from "./integrations/index";
import jobs from "./jobs/routes";
import links from "./links";
import portalAccessSettings from "./portal/access-settings";
import operations from "./operations/index";
import portalInvites from "./portal/invites";
import { profileTeamContext } from "./portal/public-profile";
import quillsSettings from "./settings/index";
import websiteBranding from "./settings/website-branding";
import reporting from "./reporting/index";
import sharedTeams from "./teams";
import taxonomy from "./feedback/taxonomy";
import supportTickets from "./support/tickets-router";
import surveys from "./feedback/surveys";
import supportConversations from "./support/conversations-router";
import supportAssistant from "./support/conversation-assistant";
import workspaceSearch from "./assistant/search";
import supportTyping from "./support/customer/typing";
import supportPresence from "./support/presence";
import supportLinkPreview from "./support/link-preview";
import supportReadBatch from "./support/read-batch";
import testConversations from "./support/test-conversations";
// RFC 0003 lane L5.
import changelogAi from "./feedback/changelog-ai";
import changelogEngagement from "./feedback/changelog-engagement";
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
  .route("/", websiteBranding)
  .route("/", feedback)
  .route("/", delivery)
  .route("/", taxonomy)
  .route("/", portalAccessSettings)
  .route("/", content)
  .route("/", integrations)
  .route("/", operations)
  .route("/", supportTickets)
  .route("/", supportConversations)
  .route("/", supportAssistant)
  .route("/", workspaceSearch)
  .route("/", supportTyping)
  .route("/", supportPresence)
  .route("/", supportLinkPreview)
  .route("/", supportReadBatch)
  .route("/", testConversations)
  .route("/", portalInvites)
  .route("/", profileTeamContext)
  .route("/", reporting)
  .route("/", automation)
  .route("/", assistant)
  .route("/", apps)
  .route("/", agentChannels)
  .route("/", surveys)
  // RFC 0003 lane L5.
  .route("/", changelogAi)
  .route("/", changelogEngagement)
  .openapi(...context);
