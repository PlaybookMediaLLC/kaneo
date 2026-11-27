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
import portalSignInSettings from "./portal/sign-in-settings";
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
import changelogTranslations from "./feedback/changelog-translations";
// RFC 0003, lane L3.
import boardSettings from "./feedback/board-settings";
import boardDelivery from "./feedback/board-delivery";
import postTasks from "./feedback/post-tasks";
import postUpdates from "./feedback/post-updates";
import demand from "./feedback/demand";
import scores from "./feedback/scores";
import scoring from "./feedback/scoring";
// RFC 0004: the AI chip of the request detail.
import postSummary from "./feedback/post-summary";
import assistantGuardrails from "./assistant/guardrails";
import privacy from "./privacy/index";
import releases from "./releases/routes";
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

const contextRouter = apiRouter<
  BaseVariables & { workspaceId: string }
>().openapi(...context);

// Flat router tuple for @kaneo/libs so Hono's client type expands each sub-router independently
// instead of recursing over a 47-deep .route() chain during apps/web typecheck.
export type QuillsTeammateRouters = [
  typeof files,
  typeof jobs,
  typeof links,
  typeof sharedTeams,
  typeof directory,
  typeof quillsSettings,
  typeof websiteBranding,
  typeof feedback,
  typeof delivery,
  typeof taxonomy,
  typeof portalAccessSettings,
  typeof portalSignInSettings,
  typeof content,
  typeof integrations,
  typeof operations,
  typeof supportTickets,
  typeof supportConversations,
  typeof supportAssistant,
  typeof workspaceSearch,
  typeof supportTyping,
  typeof supportPresence,
  typeof supportLinkPreview,
  typeof supportReadBatch,
  typeof testConversations,
  typeof portalInvites,
  typeof profileTeamContext,
  typeof reporting,
  typeof automation,
  typeof assistant,
  typeof apps,
  typeof agentChannels,
  typeof surveys,
  typeof changelogAi,
  typeof changelogEngagement,
  typeof changelogTranslations,
  typeof boardSettings,
  typeof boardDelivery,
  typeof postTasks,
  typeof postUpdates,
  typeof demand,
  typeof scores,
  typeof scoring,
  typeof postSummary,
  typeof assistantGuardrails,
  typeof privacy,
  typeof releases,
  typeof contextRouter,
];

const quillsRouter = apiRouter<BaseVariables & { workspaceId: string }>();
quillsRouter.route("/", files);
quillsRouter.route("/", jobs);
quillsRouter.route("/", links);
quillsRouter.route("/", sharedTeams);
quillsRouter.route("/", directory);
quillsRouter.route("/", quillsSettings);
quillsRouter.route("/", websiteBranding);
quillsRouter.route("/", feedback);
quillsRouter.route("/", delivery);
quillsRouter.route("/", taxonomy);
quillsRouter.route("/", portalAccessSettings);
quillsRouter.route("/", portalSignInSettings);
quillsRouter.route("/", content);
quillsRouter.route("/", integrations);
quillsRouter.route("/", operations);
quillsRouter.route("/", supportTickets);
quillsRouter.route("/", supportConversations);
quillsRouter.route("/", supportAssistant);
quillsRouter.route("/", workspaceSearch);
quillsRouter.route("/", supportTyping);
quillsRouter.route("/", supportPresence);
quillsRouter.route("/", supportLinkPreview);
quillsRouter.route("/", supportReadBatch);
quillsRouter.route("/", testConversations);
quillsRouter.route("/", portalInvites);
quillsRouter.route("/", profileTeamContext);
quillsRouter.route("/", reporting);
quillsRouter.route("/", automation);
quillsRouter.route("/", assistant);
quillsRouter.route("/", assistantGuardrails);
quillsRouter.route("/", apps);
quillsRouter.route("/", agentChannels);
quillsRouter.route("/", surveys);
// RFC 0003 lane L5.
quillsRouter.route("/", changelogAi);
quillsRouter.route("/", changelogEngagement);
quillsRouter.route("/", changelogTranslations);
// RFC 0003, lane L3.
quillsRouter.route("/", boardSettings);
// RFC 0005: requests become Kaneo tasks.
quillsRouter.route("/", boardDelivery);
quillsRouter.route("/", postTasks);
// #92: one update to every channel.
quillsRouter.route("/", postUpdates);
quillsRouter.route("/", demand);
quillsRouter.route("/", scores);
quillsRouter.route("/", scoring);
// RFC 0004: the AI chip of the request detail.
quillsRouter.route("/", postSummary);
// #329: Privacy built in (erasure, redaction, retention schedules, DSAR exports).
quillsRouter.route("/", privacy);
// #298: Verified release loop (drafts, human approval, deduplicated notifications).
quillsRouter.route("/", releases);
quillsRouter.route("/", contextRouter);

export default quillsRouter;
