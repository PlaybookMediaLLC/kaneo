import { apiRouter, type BaseVariables } from "../../../openapi";
import articles from "./articles";
import categories from "./categories";
import feedback from "./feedback";
import redirectRules from "./redirect-rules";
import settings from "./settings";
import translations from "./translations";

/** Teammate routes for help-center content, translations, redirects and settings. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", categories)
  .route("/", articles)
  .route("/", feedback)
  .route("/", translations)
  .route("/", redirectRules)
  .route("/", settings);
