import { apiRouter } from "../../openapi";
import access from "./access";
import config from "./config";
import inviteAccept from "./invite-accept";
import myFeedback from "./my-feedback";
import preferences from "./preferences";
import profile from "./profile";
import publicProfile from "./public-profile";
import subscriptions from "./subscriptions";
import unsubscribe from "./unsubscribe";

// Portal and public routes under /quills-public/{workspace}. Each module declares its routes
// with ../framework/define-route. The teammate writers (access-settings.ts, invites.ts) mount in ../index.ts.
export default apiRouter()
  .route("/", config)
  .route("/", access)
  .route("/", profile)
  .route("/", publicProfile)
  .route("/", inviteAccept)
  .route("/", subscriptions)
  .route("/", preferences)
  .route("/", unsubscribe)
  .route("/", myFeedback);
