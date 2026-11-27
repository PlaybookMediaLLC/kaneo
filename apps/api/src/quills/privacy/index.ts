import { apiRouter, type BaseVariables } from "../../openapi";
import eraseCustomer from "./erase-customer";
import exportSubject from "./export-subject";
import redactMessage from "./redact-message";
import retentionPolicies from "./retention-policies";

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", retentionPolicies)
  .route("/", eraseCustomer)
  .route("/", exportSubject)
  .route("/", redactMessage);
