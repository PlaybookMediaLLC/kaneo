import { apiRouter, type BaseVariables } from "../../../openapi";
import components from "./components";
import groups from "./groups";
import incidents from "./incidents";
import overview from "./overview";
import settings from "./settings";
import subscribers from "./subscribers";
import templates from "./templates";

/** Teammate routes for the status page: components, incidents, templates, subscribers and settings. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", components)
  .route("/", groups)
  .route("/", incidents)
  .route("/", templates)
  .route("/", subscribers)
  .route("/", overview)
  .route("/", settings);
