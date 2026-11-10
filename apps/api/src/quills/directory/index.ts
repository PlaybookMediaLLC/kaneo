import { apiRouter, type BaseVariables } from "../../openapi";
import attributes from "./attributes";
import auditLog from "./audit-log";
import blocking from "./blocking";
import companies from "./companies";
import leadMerge from "./lead-merge";
import people from "./people";
import principals from "./principals";
import segments from "./segments";
import userTags from "./user-tags";

// The directory router. Each module declares its routes with ../framework/define-route.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", people)
  .route("/", leadMerge)
  .route("/", userTags)
  .route("/", blocking)
  .route("/", companies)
  .route("/", attributes)
  .route("/", segments)
  .route("/", auditLog)
  .route("/", principals);
