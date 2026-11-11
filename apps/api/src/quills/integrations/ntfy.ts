import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  credentialText,
  sealCredentials,
  validateWebhookUrl,
} from "../framework/integration-config";
import {
  connect,
  connectErrors,
  connected,
  connectedEvent,
  ntfyTopic,
} from "./connect";

const saveNtfy = defineQuillsRoute({
  method: "put",
  path: "/integrations/ntfy/connection",
  operationId: "saveQuillsNtfy",
  summary: "Connect an ntfy topic",
  description:
    "The topic URL must resolve to a public address. The URL and the optional access token are stored encrypted and never returned. Nothing is sent when they are saved.",
  action: "manage_settings",
  body: z.object({
    url: z.url().max(2048),
    token: z.string().max(500).regex(credentialText).optional(),
  }),
  load: async ({ body }) => {
    ntfyTopic(body.url);
    const url = new URL(await validateWebhookUrl(body.url));
    const { token } = body;
    return {
      secrets: sealCredentials(
        token ? { url: url.href, token } : { url: url.href },
      ),
      workspaceName: "ntfy",
      account: url.hostname,
    };
  },
  response: connected,
  responseDescription: "The connection without its URL or token",
  errors: connectErrors,
  event: connectedEvent,
  handler: ({ db, actor, loaded }) => connect(db, actor, "ntfy", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveNtfy,
);
