import { apiRouter, z, type BaseVariables } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import {
  checkProviderCredentials,
  credentialText,
  sealCredentials,
} from "../framework/integration-config";
import { connect, connectErrors, connected, connectedEvent } from "./connect";

const saveShortcut = defineQuillsRoute({
  method: "put",
  path: "/integrations/shortcut/connection",
  operationId: "saveQuillsShortcutToken",
  summary: "Connect Shortcut with an API token",
  description:
    "Checks the token with one request to the Shortcut API. The token is stored encrypted and never returned. A rejected token returns 400; an unreachable provider returns 502.",
  action: "manage_settings",
  body: z.object({ apiToken: z.string().max(200).regex(credentialText) }),
  load: async ({ body }) => {
    // Sealing first: without the instance key nothing is sent.
    const secrets = sealCredentials({ apiKey: body.apiToken });
    const member = await checkProviderCredentials(
      "https://api.app.shortcut.com/api/v3/member",
      { "shortcut-token": body.apiToken },
    );
    const workspace = (member.workspace2 ?? {}) as {
      name?: unknown;
      url_slug?: unknown;
    };
    const text = (value: unknown) =>
      typeof value === "string" && value ? value.slice(0, 100) : null;
    return {
      secrets,
      workspaceName: text(workspace.name) ?? "Shortcut",
      account: text(workspace.url_slug),
    };
  },
  response: connected,
  responseDescription: "The connection without its token",
  errors: connectErrors,
  event: connectedEvent,
  handler: ({ db, actor, loaded }) => connect(db, actor, "shortcut", loaded),
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...saveShortcut,
);
