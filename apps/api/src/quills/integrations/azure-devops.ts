import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  credentialText,
  sealCredentials,
} from "../framework/integration-config";
import { connect, connectErrors, connected, connectedEvent } from "./connect";
import { providerFailure } from "./oauth-providers";
import { azureDevops, organizationName } from "./providers/azure-devops";

// Azure DevOps connects with a personal access token, not OAuth. Its destinations use the shared
// destinations route (oauth.ts).
const saveAzureDevops = defineQuillsRoute({
  method: "put",
  path: "/integrations/azure-devops/connection",
  operationId: "saveQuillsAzureDevopsKey",
  summary: "Connect Azure DevOps with a personal access token",
  description:
    "Checks the token with one request that lists the organization's projects on dev.azure.com. The token is stored encrypted and never returned. A rejected token or organization returns 400; an unreachable provider returns 502.",
  action: "manage_settings",
  body: z.object({
    token: z.string().min(1).max(500).regex(credentialText),
    // The name enters the provider URL: letters, digits and inner hyphens only.
    organization: z.string().max(50).regex(organizationName),
  }),
  load: async ({ body }) => {
    // Sealing first: without the instance key nothing is sent.
    sealCredentials({});
    const found = await azureDevops
      .connectWithKey(body.token, { organization: body.organization })
      .catch(providerFailure);
    return { ...found, secrets: sealCredentials(found.secrets) };
  },
  response: connected,
  responseDescription: "The connection without its token",
  errors: {
    400: "Azure DevOps rejected the token or the organization",
    ...connectErrors,
    502: "The provider could not be reached",
  },
  event: connectedEvent,
  handler: ({ db, actor, loaded }) =>
    connect(db, actor, "azure_devops", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveAzureDevops,
);
