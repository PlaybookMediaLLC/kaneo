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

/** Receipt fields: the switchable modules. Feedback is always on. */
export const labsReceipt = [
  "featureFlags.changelog",
  "featureFlags.helpCenter",
  "featureFlags.supportInbox",
  "featureFlags.supportTickets",
  "featureFlags.statusPage",
] as const;

export default settingsArea({
  name: "labs",
  title: "FeatureFlag",
  label: "feature flag",
  response: flags.extend({ feedback: z.boolean() }),
  read: (row) => resolveFlags(parseJson(row.featureFlags)),
  patch: flags.partial(),
  receipt: labsReceipt,
  // Unknown and retired flags are dropped on write. A flag that was never set keeps no stored
  // value (its default applies), so a receipt holds only the flags that the write changed.
  apply: (row, patch) => {
    const stored = parseJson(row.featureFlags);
    const kept = Object.keys(defaults).flatMap((key) =>
      typeof stored[key] === "boolean" ? [[key, stored[key]]] : [],
    );
    return {
      featureFlags: JSON.stringify({
        ...Object.fromEntries(kept),
        ...defined(patch),
      }),
    };
  },
});
