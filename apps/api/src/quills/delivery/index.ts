import { apiRouter, type BaseVariables } from "../../openapi";
import changelogSubscribers from "./changelog-subscribers";
import notificationPreferences from "./notification-preferences";
import notifications from "./notifications";
import postSubscriptions from "./post-subscriptions";
import webhooks from "./webhooks";

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", webhooks)
  .route("/", notifications)
  .route("/", notificationPreferences)
  .route("/", postSubscriptions)
  .route("/", changelogSubscribers);
