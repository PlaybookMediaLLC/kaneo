import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  checkProviderCredentials,
  sealCredentials,
} from "../framework/integration-config";
import { connect, connectErrors, connected, connectedEvent } from "./connect";

const saveStripe = defineQuillsRoute({
  method: "put",
  path: "/integrations/stripe/connection",
  operationId: "saveQuillsStripeKey",
  summary: "Connect Stripe with an API key",
  description:
    "Use a restricted key (rk_) or a secret key (sk_). Checks it with one request to the Stripe API. The key is stored encrypted and never returned. A rejected key returns 400; an unreachable provider returns 502.",
  action: "manage_settings",
  body: z.object({
    apiKey: z
      .string()
      .max(255)
      .regex(/^(rk|sk)_[A-Za-z0-9_]+$/),
  }),
  load: async ({ body }) => {
    // Sealing first: without the instance key nothing is sent.
    const secrets = sealCredentials({ apiKey: body.apiKey });
    await checkProviderCredentials("https://api.stripe.com/v1/balance", {
      authorization: `Bearer ${body.apiKey}`,
    });
    return { secrets, workspaceName: "Stripe", account: null };
  },
  response: connected,
  responseDescription: "The connection without its key",
  errors: connectErrors,
  event: connectedEvent,
  handler: ({ db, actor, loaded }) => connect(db, actor, "stripe", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveStripe,
);
