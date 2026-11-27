import { apiRouter, type BaseVariables } from "../../openapi";
import attributes from "./attributes";
import auditLog from "./audit-log";
import blocking from "./blocking";
import companies from "./companies";
import companyImport from "./company-import";
import contactIdentities from "./contact-identities";
import leadMerge from "./lead-merge";
import people from "./people";
import principals from "./principals";
import segments from "./segments";
import timeline from "./timeline";
import userComments from "./user-comments";
import userTags from "./user-tags";

// The directory router. Each module declares its routes with ../framework/define-route.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", contactIdentities)
  .route("/", people)
  .route("/", timeline)
  .route("/", userComments)
  .route("/", leadMerge)
  .route("/", userTags)
  .route("/", blocking)
  .route("/", companyImport)
  .route("/", companies)
  .route("/", attributes)
  .route("/", segments)
  .route("/", auditLog)
  .route("/", principals);
