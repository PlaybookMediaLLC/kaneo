import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  credentialText,
  sealCredentials,
} from "../framework/integration-config";
import { connect, connectErrors, connected, connectedEvent } from "./connect";

// Segment sends identify calls to the signed identify route (inbound.ts). The shared secret signs
// them; it is stored encrypted and never returned. Nothing is sent to Segment.

const saveSegment = defineQuillsRoute({
  method: "put",
  path: "/integrations/segment/connection",
  operationId: "saveQuillsSegmentConnection",
  summary: "Connect Segment with its shared secret",
  description:
    "Segment signs each identify call with this secret (x-signature). Send them to /api/quills-public/signed/integrations/segment/{integrationId}/identify.",
  action: "manage_settings",
  body: z.object({
    incomingSecret: z.string().min(16).max(500).regex(credentialText),
  }),
  load: async ({ body }) => ({
    secrets: sealCredentials({ incomingSecret: body.incomingSecret }),
    workspaceName: "Segment",
    account: null,
  }),
  response: connected,
  responseDescription: "The connection without its secret",
  errors: connectErrors,
  event: connectedEvent,
  handler: ({ db, actor, loaded }) => connect(db, actor, "segment", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveSegment,
);
