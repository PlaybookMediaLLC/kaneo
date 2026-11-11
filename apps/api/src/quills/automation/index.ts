// Mounts the P8a automation routes declared with ../framework/define-route.
import { apiRouter, type BaseVariables } from "../../openapi";
import runs from "./runs";
import settings from "./settings";
import workflows from "./workflows";

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", workflows)
  .route("/", runs)
  .route("/", settings);
