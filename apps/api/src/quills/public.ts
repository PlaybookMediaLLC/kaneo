import { apiRouter } from "../openapi";
import inboundEmail from "./inbound/email";
import integrationWebhooks from "./integrations/inbound";
import { oauthCallback } from "./integrations/oauth";
import jobWake from "./jobs/wake";
import portalFeedback from "./portal/feedback/index";
import portal from "./portal/index";
import widgetFeedback from "./widget/feedback/index";
import widget from "./widget/index";

// Portal, widget and public Quills routes. src/index.ts mounts this router at /quills-public
// before Kaneo's session middleware: each route resolves its own caller in framework/audience.ts
// and never runs through withQuillsRequest. Signed routes (/signed/...) prove the caller with a
// signature (framework/signed.ts); the internal route (/internal/...) with QUILLS_INTERNAL_TOKEN.
// They mount first, so a workspace slug never shadows their fixed prefixes.
export default apiRouter()
  .route("/", integrationWebhooks)
  .route("/", oauthCallback)
  .route("/", inboundEmail)
  .route("/", jobWake)
  .route("/", portal)
  .route("/", widget)
  .route("/", portalFeedback)
  .route("/", widgetFeedback);
