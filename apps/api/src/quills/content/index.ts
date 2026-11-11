// Mounts the P6 help-center and status routes declared with ../framework/define-route.
import { apiRouter, type BaseVariables } from "../../openapi";
import helpCenter from "./help-center/index";
import status from "./status/index";

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", helpCenter)
  .route("/", status);
