import { z } from "../../openapi";
import { bool, defined, parseJson, settingsArea } from "./area";

// Routes come from settingsArea, which declares them with ../framework/define-route.
// Product modules (#307). Feedback is the portal home page, so it is always on.
// Surveys and AI default to off so a solo founder starts with a lean workspace.

const defaults = {
  roadmap: true,
  changelog: true,
  helpCenter: false,
  supportInbox: false,
  supportTickets: false,
  statusPage: false,
  surveys: false,
  ai: false,
};
const flags = z.object({
  roadmap: z.boolean(),
  changelog: z.boolean(),
  helpCenter: z.boolean(),
  supportInbox: z.boolean(),
  supportTickets: z.boolean(),
  statusPage: z.boolean(),
  surveys: z.boolean(),
  ai: z.boolean(),
});

export const resolveFlags = (stored: Record<string, unknown>) => ({
  feedback: true,
  roadmap: bool(stored.roadmap, defaults.roadmap),
  changelog: bool(stored.changelog, defaults.changelog),
  helpCenter: bool(stored.helpCenter, defaults.helpCenter),
  supportInbox: bool(stored.supportInbox, defaults.supportInbox),
  supportTickets: bool(stored.supportTickets, defaults.supportTickets),
  statusPage: bool(stored.statusPage, defaults.statusPage),
  surveys: bool(stored.surveys, defaults.surveys),
  ai: bool(stored.ai, defaults.ai),
});

/** Receipt fields: the switchable modules. Feedback is always on. */
export const labsReceipt = [
  "featureFlags.roadmap",
  "featureFlags.changelog",
  "featureFlags.helpCenter",
  "featureFlags.supportInbox",
  "featureFlags.supportTickets",
  "featureFlags.statusPage",
  "featureFlags.surveys",
  "featureFlags.ai",
] as const;

export default settingsArea({
  name: "labs",
  title: "FeatureFlag",
  label: "feature flag",
  response: flags.extend({ feedback: z.boolean() }),
  read: (row) => resolveFlags(parseJson(row.featureFlags)),
  patch: flags.partial(),
  receipt: labsReceipt,
  // Unknown and retired flags are dropped on write while preserving workspace preset/setup metadata.
  apply: (row, patch) => {
    const stored = parseJson(row.featureFlags);
    const kept = Object.keys(defaults).flatMap((key) =>
      typeof stored[key] === "boolean" ? [[key, stored[key]]] : [],
    );
    const meta: Record<string, unknown> = {};
    if (typeof stored.preset === "string") meta.preset = stored.preset;
    if (stored.setupState && typeof stored.setupState === "object") {
      meta.setupState = stored.setupState;
    }
    return {
      featureFlags: JSON.stringify({
        ...meta,
        ...Object.fromEntries(kept),
        ...defined(patch),
      }),
    };
  },
});
