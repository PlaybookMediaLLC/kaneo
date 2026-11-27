import { apiRouter, type BaseVariables } from "../../../openapi";
import articles from "./articles";
import categories from "./categories";
import feedback from "./feedback";
import freshness from "./freshness";
import redirectRules from "./redirect-rules";
import searchInsights from "./search-insights";
import settings from "./settings";
import translations from "./translations";

/** Teammate routes for help-center content, freshness, search insights, translations, redirects and settings. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", categories)
  .route("/", freshness)
  .route("/", searchInsights)
  .route("/", articles)
  .route("/", feedback)
  .route("/", translations)
  .route("/", redirectRules)
  .route("/", settings);
