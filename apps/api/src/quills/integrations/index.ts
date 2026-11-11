import { apiRouter, type BaseVariables } from "../../openapi";
import channels from "./channels";
import contacts from "./contacts";
import externalLinks from "./external-links";
import freshdesk from "./freshdesk";
import integrations from "./integrations";
import make from "./make";
import n8n from "./n8n";
import ntfy from "./ntfy";
import oauth from "./oauth";
import shortcut from "./shortcut";
import statusSync from "./status-sync";
import stripe from "./stripe";
import syncs from "./syncs";
import zapier from "./zapier";

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .route("/", integrations)
  .route("/", channels)
  .route("/", syncs)
  .route("/", externalLinks)
  .route("/", make)
  .route("/", n8n)
  .route("/", zapier)
  .route("/", ntfy)
  .route("/", freshdesk)
  .route("/", shortcut)
  .route("/", stripe)
  .route("/", oauth)
  .route("/", statusSync)
  .route("/", contacts);
