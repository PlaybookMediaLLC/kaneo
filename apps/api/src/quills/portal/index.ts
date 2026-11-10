import { apiRouter } from "../../openapi";
import access from "./access";
import config from "./config";
import profile from "./profile";

// Portal and public routes under /quills-public/{workspace}. Each module declares its routes
// with ../framework/define-route. The teammate writer (access-settings.ts) mounts in ../index.ts.
export default apiRouter()
  .route("/", config)
  .route("/", access)
  .route("/", profile);
