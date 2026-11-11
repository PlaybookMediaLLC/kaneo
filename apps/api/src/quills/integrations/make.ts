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

const saveMake = defineQuillsRoute({
  method: "put",
  path: "/integrations/make/connection",
  operationId: "saveQuillsMakeWebhook",
  summary: "Connect Make with a scenario webhook URL",
  description:
    "Accepts an HTTPS URL on a Make host (*.make.com, *.integromat.com). The URL is stored encrypted and never returned. Nothing is sent when it is saved.",
  action: "manage_settings",
  body: webhookBody,
  load: async ({ body }) => {
    const url = ownHostUrl("make", body.webhookUrl);
    return {
      secrets: sealCredentials({ url: url.href }),
      workspaceName: "Make",
      account: url.hostname,
    };
  },
  response: connected,
  responseDescription: "The connection without its URL",
  errors: connectErrors,
  event: connectedEvent,
  handler: ({ db, actor, loaded }) => connect(db, actor, "make", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveMake,
);
