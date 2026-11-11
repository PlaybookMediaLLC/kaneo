import { apiRouter, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { sealCredentials } from "../framework/integration-config";
import {
  connect,
  connectErrors,
  connected,
  connectedEvent,
  ownHostUrl,
  webhookBody,
} from "./connect";

const saveZapier = defineQuillsRoute({
  method: "put",
  path: "/integrations/zapier/connection",
  operationId: "saveQuillsZapierWebhook",
  summary: "Connect Zapier with a webhook URL",
  description:
    "Accepts an HTTPS URL on hooks.zapier.com. The URL is stored encrypted and never returned. Nothing is sent when it is saved.",
  action: "manage_settings",
  body: webhookBody,
  load: async ({ body }) => {
    const url = ownHostUrl("zapier", body.webhookUrl);
    return {
      secrets: sealCredentials({ url: url.href }),
      workspaceName: "Zapier",
      account: url.hostname,
    };
  },
  response: connected,
  responseDescription: "The connection without its URL",
  errors: connectErrors,
  event: connectedEvent,
  handler: ({ db, actor, loaded }) => connect(db, actor, "zapier", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveZapier,
);
