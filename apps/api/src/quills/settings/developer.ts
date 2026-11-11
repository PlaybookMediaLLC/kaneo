import { z } from "../../openapi";
import { bool, defined, parseJson, settingsArea } from "./area";

// Routes come from settingsArea, which declares them with ../framework/define-route.
// Quills developer switches. Kaneo API keys and the Kaneo MCP server keep their own settings.

const config = z.object({
  mcpEnabled: z.boolean(),
  mcpPortalAccessEnabled: z.boolean(),
  oauthDynamicClientRegistrationEnabled: z.boolean(),
  personalApiKeysEnabled: z.boolean(),
});

export default settingsArea({
  name: "developer",
  title: "Developer",
  label: "developer",
  response: config,
  read: (row) => {
    const stored = parseJson(row.developerConfig);
    return {
      mcpEnabled: bool(stored.mcpEnabled, true),
      mcpPortalAccessEnabled: bool(stored.mcpPortalAccessEnabled, false),
      oauthDynamicClientRegistrationEnabled: bool(
        stored.oauthDynamicClientRegistrationEnabled,
        true,
      ),
      personalApiKeysEnabled: bool(stored.personalApiKeysEnabled, true),
    };
  },
  patch: config.partial(),
  apply: (row, patch) => ({
    developerConfig: JSON.stringify({
      ...parseJson(row.developerConfig),
      ...defined(patch),
    }),
  }),
});
