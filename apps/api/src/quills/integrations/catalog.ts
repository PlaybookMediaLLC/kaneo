// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { z } from "../../openapi";

/**
 * Event types that an integration can deliver. A deletion notice is not one: the shared purge trigger stops
 * deliveries about a deleted or unpublished post, as in the source.
 */
export const deliveredEvent = z.enum([
  "post.created",
  "post.status_changed",
  "comment.created",
]);
export type DeliveredEvent = z.infer<typeof deliveredEvent>;

const webhookEvents: DeliveredEvent[] = deliveredEvent.options;

type Provider = {
  name: string;
  category: string;
  description: string;
  events: DeliveredEvent[];
  /** True when the provider sends to targets inside the account (channels), not to the connection. */
  channels: boolean;
  /** The webhook hosts, when the provider accepts only its own. */
  hosts?: RegExp;
};

/** The providers this build connects: an API key or a webhook URL, no OAuth. */
export const providers = {
  make: {
    name: "Make",
    category: "automation",
    description: "Send feedback events to Make scenarios.",
    events: webhookEvents,
    channels: false,
    hosts: /\.(make|integromat)\.com$/,
  },
  n8n: {
    name: "n8n",
    category: "automation",
    description: "Send feedback events to n8n workflows.",
    events: webhookEvents,
    channels: false,
  },
  zapier: {
    name: "Zapier",
    category: "automation",
    description: "Send feedback events to Zapier automations.",
    events: webhookEvents,
    channels: false,
    hosts: /^hooks\.zapier\.com$/,
  },
  ntfy: {
    name: "ntfy",
    category: "notifications",
    description: "Send push notifications to an ntfy topic.",
    events: ["post.created", "post.status_changed", "comment.created"],
    channels: false,
  },
  freshdesk: {
    name: "Freshdesk",
    category: "support_crm",
    description: "Connect a Freshdesk help desk with an API key.",
    events: [],
    channels: false,
  },
  shortcut: {
    name: "Shortcut",
    category: "issue_tracking",
    description: "Create Shortcut stories from new feedback.",
    events: ["post.created"],
    channels: true,
  },
  stripe: {
    name: "Stripe",
    category: "support_crm",
    description: "Connect a Stripe account with a restricted API key.",
    events: [],
    channels: false,
  },
} satisfies Record<string, Provider>;
export type ProviderType = keyof typeof providers;
export const provider = (type: string): Provider | undefined =>
  (providers as Record<string, Provider>)[type];

/** Source providers that need OAuth, inbound webhooks or other work that this build does not have. */
const later = [
  ["asana", "Asana", "issue_tracking"],
  ["azure_devops", "Azure DevOps", "issue_tracking"],
  ["clickup", "ClickUp", "issue_tracking"],
  ["discord", "Discord", "notifications"],
  ["github", "GitHub", "issue_tracking"],
  ["gitlab", "GitLab", "issue_tracking"],
  ["hubspot", "HubSpot", "support_crm"],
  ["intercom", "Intercom", "support_crm"],
  ["jira", "Jira", "issue_tracking"],
  ["linear", "Linear", "issue_tracking"],
  ["monday", "Monday.com", "issue_tracking"],
  ["notion", "Notion", "issue_tracking"],
  ["salesforce", "Salesforce", "support_crm"],
  ["segment", "Segment", "user_data"],
  ["slack", "Slack", "notifications"],
  ["teams", "Microsoft Teams", "notifications"],
  ["trello", "Trello", "issue_tracking"],
  ["zendesk", "Zendesk", "support_crm"],
] as const;

export const catalog = [
  ...Object.entries(providers).map(([id, entry]: [string, Provider]) => ({
    id,
    name: entry.name,
    category: entry.category,
    description: entry.description,
    available: true,
    events: entry.events,
  })),
  ...later.map(([id, name, category]) => ({
    id,
    name,
    category,
    description: "Not available in this build.",
    available: false,
    events: [] as DeliveredEvent[],
  })),
];

/** Sync error codes and their messages, authored for people. Provider and SQL errors never reach a response. */
const SYNC_ERRORS: Record<string, string> = {
  provider_failed: "The provider rejected the request.",
  authentication: "The provider rejected the saved credentials.",
  credentials_unavailable: "The saved credentials cannot be read.",
  unavailable: "The provider was unavailable.",
  outcome_unknown:
    "The delivery may have reached the provider. It is not sent again automatically.",
  destination_rejected: "The destination is not a public address.",
  installation_changed: "The integration changed before delivery.",
  source_unavailable: "The feedback is no longer available.",
  cancelled_by_user: "Cancelled by a teammate.",
};
export const syncError = (code: string | null | undefined) =>
  code ? (SYNC_ERRORS[code] ?? "This sync needs attention.") : null;

/** The installation of a connection: a reconnect starts a new one. */
export const installationOf = (row: { id: string; connectedAt: Date | null }) =>
  `${row.id}:${row.connectedAt?.toISOString() ?? "initial"}`;

/** An HTTPS URL without credentials, or null. */
export function httpsUrl(value: unknown) {
  const url = typeof value === "string" ? URL.parse(value) : null;
  return url?.protocol === "https:" && !url.username && !url.password
    ? url.href
    : null;
}
