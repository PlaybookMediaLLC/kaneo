import { apiRouter, type BaseVariables } from "../../openapi";
import dataRuns from "../transfer/runs/data-runs";
import exportRuns from "../transfer/runs/export-runs";
import fullExport from "../transfer/runs/full-export";
import importRuns from "../transfer/runs/import-runs";
import adminOverview from "./admin-overview";
import analytics from "./analytics";
import reopens from "./reopens";
import teamCounts from "./team-counts";
import visitorAnalytics from "./visitor-analytics";

// P9: reporting reads and the data transfer runs. ROUTES.md lists the routes and their checks.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", analytics)
  .route("/", adminOverview)
  .route("/", reopens)
  .route("/", visitorAnalytics)
  .route("/", teamCounts)
  .route("/", dataRuns)
  .route("/", exportRuns)
  .route("/", fullExport)
  .route("/", importRuns);
