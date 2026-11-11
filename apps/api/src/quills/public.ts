import { apiRouter } from "../openapi";
import portalFeedback from "./portal/feedback/index";
import contentPublic from "./content/public/index";
import portal from "./portal/index";
import portalSupport from "./support/customer/portal";
import widgetFeedback from "./widget/feedback/index";
import widget from "./widget/index";
import widgetHelp from "./widget/help/index";
import widgetKbAsk from "./widget/kb-ask";
import widgetSupport from "./widget/support/index";

// Portal, widget and public Quills routes. src/index.ts mounts this router at /quills-public
// before Kaneo's session middleware: each route resolves its own caller in framework/audience.ts
// and never runs through withQuillsRequest.
export default apiRouter()
  .route("/", portal)
  .route("/", widget)
  .route("/", portalFeedback)
  .route("/", widgetFeedback)
  .route("/", widgetHelp)
  .route("/", contentPublic)
  .route("/", widgetKbAsk)
  .route("/", portalSupport)
  .route("/", widgetSupport);
