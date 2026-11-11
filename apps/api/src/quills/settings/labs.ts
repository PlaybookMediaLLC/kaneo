import { z } from "../../openapi";
import { bool, defined, parseJson, settingsArea } from "./area";

// Routes come from settingsArea, which declares them with ../framework/define-route.
// Product modules. Feedback is the portal home page, so it is always on.

const defaults = {
  changelog: true,
  helpCenter: false,
  supportInbox: false,
  supportTickets: false,
  statusPage: false,
};
const flags = z.object({
  changelog: z.boolean(),
  helpCenter: z.boolean(),
  supportInbox: z.boolean(),
  supportTickets: z.boolean(),
  statusPage: z.boolean(),
});

export const resolveFlags = (stored: Record<string, unknown>) => ({
  feedback: true,
  changelog: bool(stored.changelog, defaults.changelog),
  helpCenter: bool(stored.helpCenter, defaults.helpCenter),
  supportInbox: bool(stored.supportInbox, defaults.supportInbox),
  supportTickets: bool(stored.supportTickets, defaults.supportTickets),
  statusPage: bool(stored.statusPage, defaults.statusPage),
});

export default settingsArea({
  name: "labs",
  title: "FeatureFlag",
  label: "feature flag",
  response: flags.extend({ feedback: z.boolean() }),
  read: (row) => resolveFlags(parseJson(row.featureFlags)),
  patch: flags.partial(),
  // Unknown and retired flags are dropped on write.
  apply: (row, patch) => ({
    featureFlags: JSON.stringify({
      ...resolveFlags(parseJson(row.featureFlags)),
      ...defined(patch),
    }),
  }),
});
