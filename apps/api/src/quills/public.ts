import { apiRouter } from "../openapi";
import { connectorOAuthCallback } from "./assistant/connectors";
import avatarImage from "./files/avatar-image";
import customerFiles from "./files/customer";
import publicMedia from "./files/public-media";
import inboundEmail from "./inbound/email";
import emailEvents from "./inbound/events";
import integrationWebhooks from "./integrations/inbound";
import { oauthCallback } from "./integrations/oauth";
import jobWake from "./jobs/wake";
import portalFeedback from "./portal/feedback/index";
import contentPublic from "./content/public/index";
import portal from "./portal/index";
import portalSurveys from "./portal/surveys";
import portalTokenSignIn from "./portal/token-sign-in";
import track from "./reporting/track";
import portalSupport from "./support/customer/portal";
import widgetFeedback from "./widget/feedback/index";
import widgetHost from "./widget/host";
import widget from "./widget/index";
import widgetSurveys from "./widget/surveys";
import widgetHelp from "./widget/help/index";
import widgetKbAsk from "./widget/kb-ask";
import widgetSupport from "./widget/support/index";

// Portal, widget and public Quills routes. src/index.ts mounts this router at /quills-public
// before Kaneo's session middleware: each route resolves its own caller in framework/audience.ts
// and never runs through withQuillsRequest. widgetHost serves the widget's static page and
// bundles; it goes first because it also sets the CORS header of the widget's config.json. Signed
// routes (/signed/...) prove the caller with a signature (framework/signed.ts); the internal route
// (/internal/...) with QUILLS_INTERNAL_TOKEN. They mount before the workspace routes, so a
// workspace slug never shadows their fixed prefixes.
export type QuillsPublicRouters = [
  typeof widgetHost,
  typeof integrationWebhooks,
  typeof oauthCallback,
  typeof connectorOAuthCallback,
  typeof inboundEmail,
  typeof emailEvents,
  typeof jobWake,
  typeof portalTokenSignIn,
  typeof portal,
  typeof widget,
  typeof portalFeedback,
  typeof widgetFeedback,
  typeof widgetHelp,
  typeof contentPublic,
  typeof widgetKbAsk,
  typeof portalSupport,
  typeof widgetSupport,
  typeof customerFiles,
  typeof avatarImage,
  typeof publicMedia,
  typeof track,
  typeof portalSurveys,
  typeof widgetSurveys,
];

export default apiRouter()
  .route("/", widgetHost)
  .route("/", integrationWebhooks)
  .route("/", oauthCallback)
  .route("/", connectorOAuthCallback)
  .route("/", inboundEmail)
  .route("/", emailEvents)
  .route("/", jobWake)
  .route("/", portalTokenSignIn)
  .route("/", portal)
  .route("/", widget)
  .route("/", portalFeedback)
  .route("/", widgetFeedback)
  .route("/", widgetHelp)
  .route("/", contentPublic)
  .route("/", widgetKbAsk)
  .route("/", portalSupport)
  .route("/", widgetSupport)
  .route("/", customerFiles)
  .route("/", avatarImage)
  .route("/", publicMedia)
  .route("/", track)
  .route("/", portalSurveys)
  .route("/", widgetSurveys);
