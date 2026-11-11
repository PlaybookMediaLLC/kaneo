import { apiRouter } from "../../openapi";
import config from "./config";
import contactEmail from "./contact-email";
import identify from "./identify";
import install from "./install";
import session from "./session";

// Widget routes under /quills-public/{workspace}. Each module declares its routes with
// ../framework/define-route.
export default apiRouter()
  .route("/", config)
  .route("/", install)
  .route("/", identify)
  .route("/", contactEmail)
  .route("/", session);
