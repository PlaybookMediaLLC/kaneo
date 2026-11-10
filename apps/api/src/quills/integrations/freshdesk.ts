import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  checkProviderCredentials,
  credentialText,
  sealCredentials,
} from "../framework/integration-config";
import { connect, connectErrors, connected, connectedEvent } from "./connect";

const saveFreshdesk = defineQuillsRoute({
  method: "put",
  path: "/integrations/freshdesk/connection",
  operationId: "saveQuillsFreshdeskKey",
  summary: "Connect Freshdesk with an API key",
  description:
    "Checks the key with one request to the help desk's Freshdesk API. The key is stored encrypted and never returned. A rejected key returns 400; an unreachable provider returns 502.",
  action: "manage_settings",
  body: z.object({
    apiKey: z.string().max(200).regex(credentialText),
    subdomain: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9-]+$/),
  }),
  load: async ({ body }) => {
    const domain = `${body.subdomain}.freshdesk.com`;
    // Sealing first: without the instance key nothing is sent.
    const secrets = sealCredentials({ apiKey: body.apiKey });
    const helpdesk = await checkProviderCredentials(
      `https://${domain}/api/v2/settings/helpdesk`,
      { authorization: `Basic ${btoa(`${body.apiKey}:X`)}` },
    );
    const name = helpdesk.name;
    return {
      secrets,
      workspaceName:
        typeof name === "string" && name ? name.slice(0, 100) : domain,
      account: domain,
    };
  },
  response: connected,
  responseDescription: "The connection without its key",
  errors: connectErrors,
  event: connectedEvent,
  handler: ({ db, actor, loaded }) => connect(db, actor, "freshdesk", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveFreshdesk,
);
