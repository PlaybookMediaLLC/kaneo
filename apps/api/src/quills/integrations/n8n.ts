import { apiRouter, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  sealCredentials,
  validateWebhookUrl,
} from "../framework/integration-config";
import {
  connect,
  connectErrors,
  connected,
  connectedEvent,
  webhookBody,
} from "./connect";

const saveN8n = defineQuillsRoute({
  method: "put",
  path: "/integrations/n8n/connection",
  operationId: "saveQuillsN8nWebhook",
  summary: "Connect n8n with a workflow webhook URL",
  description:
    "The URL must resolve to a public address and carry no credentials. It is stored encrypted and never returned. Nothing is sent when it is saved.",
  action: "manage_settings",
  body: webhookBody,
  // DNS runs after the permission checks and outside the transaction.
  load: async ({ body }) => {
    const url = new URL(await validateWebhookUrl(body.webhookUrl));
    return {
      secrets: sealCredentials({ url: url.href }),
      workspaceName: "n8n",
      account: url.hostname,
    };
  },
  response: connected,
  responseDescription: "The connection without its URL",
  errors: connectErrors,
  event: connectedEvent,
  handler: ({ db, actor, loaded }) => connect(db, actor, "n8n", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveN8n,
);
