import { apiRouter } from "../../openapi";
import activity from "./activity";
import config from "./config";
import contactEmail from "./contact-email";
import identify from "./identify";
import portalSignIn from "./portal-sign-in";
import install from "./install";
import portalLink from "./portal-link";
import myRequests from "./my-requests";
import session from "./session";
import verifyToken from "./verify-token";

// Widget routes under /quills-public/{workspace}. Each module declares its routes with
// ../framework/define-route.
export default apiRouter()
  .route("/", config)
  .route("/", install)
  .route("/", identify)
  .route("/", verifyToken)
  .route("/", portalSignIn)
  .route("/", contactEmail)
  .route("/", session)
  .route("/", activity)
  .route("/", myRequests)
  .route("/", portalLink);
