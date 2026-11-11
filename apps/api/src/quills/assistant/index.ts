import { apiRouter, type BaseVariables } from "../../openapi";
import analytics from "./analytics";
import connectors from "./connectors";
import copilot from "./copilot";
import documents from "./documents";
import guidance from "./guidance";
import helpCenterAi from "./help-center-ai";
import pendingActions from "./pending-actions";
import postAi from "./post-ai";
import settings from "./settings";
import skills from "./skills";
import snippets from "./snippets";
import suggestions from "./suggestions";
import supportAi from "./support-ai";
import webSources from "./web-sources";

// P8b: the AI assistant and AI features. See ROUTES.md.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", settings)
  .route("/", guidance)
  .route("/", snippets)
  .route("/", skills)
  .route("/", webSources)
  .route("/", documents)
  .route("/", connectors)
  .route("/", copilot)
  .route("/", pendingActions)
  .route("/", suggestions)
  .route("/", postAi)
  .route("/", supportAi)
  .route("/", helpCenterAi)
  .route("/", analytics);
