// Disposition rules for the Quackback → Kaneo capability ledger.
// A rule is [pattern, domain]. The first match wins. Change a decision here (or in
// docs/quills-port/ledger/overrides.json), then rerun build-ledger.mjs.

export const DOMAINS = {
  // ---- not ported ----
  "reuse-identity": {
    disposition: "reuse Kaneo",
    phase: "-",
    reason:
      "Kaneo owns accounts, sessions, SSO, 2FA, invitations, roles, membership and API keys.",
  },
  "reuse-workspace": {
    disposition: "reuse Kaneo",
    phase: "-",
    reason:
      "Kaneo owns workspace setup. Quills defaults initialize on first scoped access.",
  },
  "reuse-platform": {
    disposition: "reuse Kaneo",
    phase: "-",
    reason:
      "Kaneo already serves health, OpenAPI docs, OAuth/MCP metadata and the MCP transport.",
  },
  "reuse-billing": {
    disposition: "reuse Kaneo",
    phase: "-",
    reason:
      "Kaneo has billing in apps/api/src/billing (checkout, provider webhooks, subscription state, seat sync, entitlement middleware). Quills features gate through that middleware.",
  },
  "reuse-telemetry": {
    disposition: "reuse Kaneo",
    phase: "-",
    reason:
      "Kaneo has product analytics (apps/web/src/lib/analytics) and its own version and onboarding prompts.",
  },
  "oos-dev": {
    disposition: "out of scope",
    phase: "-",
    reason: "Development or end-to-end test harness of the source app.",
  },
  "ui-shell": {
    disposition: "UI-only",
    phase: "-",
    reason: "App shell, layout or redirect. It has no server capability.",
  },
  // ---- ported, in dependency order ----
  framework: { disposition: "port", phase: "P0", group: "" },
  feedback: { disposition: "port", phase: "P1", group: "feedback" },
  directory: { disposition: "port", phase: "P2", group: "directory" },
  settings: { disposition: "port", phase: "P2", group: "settings" },
  files: { disposition: "port", phase: "P2", group: "files" },
  portal: { disposition: "port", phase: "P3", group: "portal" },
  widget: { disposition: "port", phase: "P3", group: "widget" },
  delivery: { disposition: "port", phase: "P4", group: "delivery" },
  support: { disposition: "port", phase: "P5", group: "support" },
  "help-center": { disposition: "port", phase: "P6", group: "help-center" },
  status: { disposition: "port", phase: "P6", group: "status" },
  integrations: { disposition: "port", phase: "P7", group: "integrations" },
  automation: { disposition: "port", phase: "P8", group: "automation" },
  assistant: { disposition: "port", phase: "P8", group: "assistant" },
  reporting: { disposition: "port", phase: "P9", group: "reporting" },
  transfer: { disposition: "port", phase: "P9", group: "transfer" },
  // Kaneo has no custom domains, fleet wake or usage endpoint, so these are ported.
  operations: { disposition: "port", phase: "P10", group: "operations" },
};

/** Route files. The path is relative to apps/web/src/routes, without `__tests__/`. */
export const ROUTE_RULES = [
  // Tests that sit at the top of routes/__tests__ and name their subject in the file name.
  [/^(admin-roadmap|admin\.loader-moderation)/, "feedback"],
  [/^admin\.(layout|loader-unread)/, "directory"],
  [/^hc-/, "help-center"],
  [/^inbox\./, "support"],
  [/^oauth-authorization-server/, "reuse-platform"],
  [/^portal[-.]/, "portal"],
  [/^(root\.|route-exports)/, "ui-shell"],
  [/^settings\.channels/, "support"],
  [/^settings\.members/, "reuse-identity"],
  [/^settings\.(labs|notifications|page-loaders)/, "settings"],
  [/^admin\/(admin-list-imports|admin-page-loaders-prefetch)/, "directory"],
  [
    /^admin\/(settings-general-identity|settings\.module-hub-redirect)/,
    "settings",
  ],
  [/^admin\/settings\.connector-detail/, "assistant"],
  [/^admin\/settings\.data-runs/, "transfer"],
  [/^admin\/settings\.messenger-surfaces/, "support"],
  [/^admin\/upgrade-catalogue/, "reuse-billing"],
  [/^admin\/settings\.security\.audit-log/, "directory"],
  [/^api\/(s3-upload-mock|upload-fixtures)/, "files"],
  [/^api\/v1\/(service-actor-guard|write-validation)/, "framework"],
  [/^__root\.tsx$/, "ui-shell"],
  [/^\[\.\]well-known/, "reuse-platform"],
  [/^api\/(mcp|health)|^api\/v1\/(docs|openapi)|^robots/, "reuse-platform"],
  [
    /^api\/auth\/portal-signin|^auth\.widget-handoff|^portal-invite|^api\/widget-sso/,
    "portal",
  ],
  [
    /^api\/auth\/|^auth\.|^admin\.(login|signup)|^verify-magic-link|^device\.tsx|^complete-signup|^oauth\/consent|^api\/v1\/(setup|members)/,
    "reuse-identity",
  ],
  [
    /^admin\/settings\.(members|security\.(authentication|sso))/,
    "reuse-identity",
  ],
  [/^onboarding/, "reuse-workspace"],
  [/^api\/internal\/identity-projection/, "reuse-identity"],
  [
    /^api\/billing\/|^api\/internal\/billing-projection|^admin\/settings\.billing/,
    "reuse-billing",
  ],
  [/^api\/plg-events/, "reuse-telemetry"],
  [
    /^api\/internal\/job-wake|^api\/v1\/admin\/usage|^admin\/settings\.domains/,
    "operations",
  ],
  [/^e2e\./, "oos-dev"],
  [/^api\/v1\/-write-validation/, "framework"],
  [
    /^api\/v1\/(boards|posts|comments|tags|statuses|roadmaps|changelog|moderation)/,
    "feedback",
  ],
  [
    /^api\/v1\/suggestions|^api\/admin\/assistant|^api\/widget\/kb-ask/,
    "assistant",
  ],
  [/^api\/v1\/(users|companies|segments|principals|mentions)/, "directory"],
  [/^api\/v1\/settings/, "settings"],
  [
    /^api\/v1\/files|^api\/(upload|storage|files)\/|^api\/portal\/(files|upload)/,
    "files",
  ],
  [/^api\/v1\/webhooks|^api\/devices|^unsubscribe/, "delivery"],
  [
    /^api\/v1\/(conversations|tickets|ticket-statuses)|^api\/chat\/|^csat/,
    "support",
  ],
  [
    /^api\/v1\/help-center|^api\/widget\/kb-search|^hc\/|^_portal\/hc|^help[.$]/,
    "help-center",
  ],
  [/^api\/v1\/status|^status\/|^_portal\/status/, "status"],
  [/^api\/v1\/apps|^api\/integrations\/|^oauth\/|^apps/, "integrations"],
  [/^api\/(export|import)/, "transfer"],
  [/^api\/track/, "reporting"],
  [/^api\/widget\/|^widget/, "widget"],
  [/^api\/user\/|^_portal|^changelog\/|^sitemap/, "portal"],
  [
    /^admin\/(feedback|roadmap|changelog|moderation)|^admin\/settings\.(boards|statuses|tags|feedback|changelog|moderation)/,
    "feedback",
  ],
  [
    /^admin\/(inbox|tickets)|^admin\/settings\.(conversations|conversation-data|channels\.|channels_\.(email|messenger)|macros|office-hours|sla|support|ticket-)/,
    "support",
  ],
  [/^admin\/help-center|^admin\/settings\.help-center/, "help-center"],
  [/^admin\/status|^admin\/settings\.status\./, "status"],
  [/^admin\/settings\.(integrations|channels_\.github)/, "integrations"],
  [
    /^admin\/automation.*workflows|^admin\/settings(_)?\.workflows/,
    "automation",
  ],
  [
    /^admin\/automation|^admin\/settings\.(agent|ai|copilot|skills|mcp|connectors)/,
    "assistant",
  ],
  [/^admin\/analytics/, "reporting"],
  [/^admin\/settings\.imports/, "transfer"],
  [
    /^admin\/settings\.(widget|portal|branding|general|developers|labs|notifications|index)|^admin\/settings\.tsx|^admin\/settings\//,
    "settings",
  ],
  [
    /^admin\/settings\.(people|companies|team|teams)|^admin\/(users|search|notifications|index|getting-started)|^admin\.tsx/,
    "directory",
  ],
];

/** Server functions. The key is `<file relative to apps/web/src>#<exported name>`. */
export const CAPABILITY_RULES = [
  // admin.ts mixes several owners; split it by function.
  [
    /functions\/admin\.ts#(fetchTeamMembers|updateMemberRole|forceSignOutUser|removeTeamMember|cancelInvitation|resendInvitation|getPublicAuthConfig)/,
    "reuse-identity",
  ],
  [
    /functions\/admin\.ts#(fetchOnboardingStatus|setLaunchTaskResolution|checkOnboardingState)/,
    "reuse-workspace",
  ],
  [
    /functions\/admin\.ts#(fetchInboxPosts|fetchTagsList|fetchStatusesList)/,
    "feedback",
  ],
  [/functions\/admin\.ts#fetchIntegration/, "integrations"],
  [/functions\/admin\.ts#/, "directory"],
  [
    /functions\/settings\.ts#(fetchPublicAuthConfig|fetchAuthConfig|updateAuthConfig|fetchTeamMembersAndInvitations|fetchUserProfile|updateWorkspaceName)/,
    "reuse-identity",
  ],
  [
    /functions\/settings\.ts#(fetchOfficeHours|updateOfficeHours|fetchConversationRouting|updateConversationRouting|fetchEmailAutoAck|updateEmailAutoAck|fetchDefaultSlaPolicy|updateDefaultSlaPolicy|getSpamFilterConfig|updateSpamFilterConfig|getEmailChannelStatus)/,
    "support",
  ],
  [/functions\/settings\.ts#(fetchWorkflow|updateWorkflow)/, "automation"],
  [
    /functions\/settings\.ts#(fetchChangelogSettings|updateChangelogSettings|updateModerationDefault)/,
    "feedback",
  ],
  [/functions\/settings\.ts#(fetchPublicPortalConfig)/, "portal"],
  [
    /functions\/(settings|settings-utils|website-branding|locale|feature-flags|workspace-utils)\.ts#/,
    "settings",
  ],
  [
    /functions\/user\.ts#(getNotificationPreferences|updateNotificationPreferences)/,
    "delivery",
  ],
  [/functions\/user\.ts#/, "portal"],
  [/functions\/teams\.ts#assignConversationTeam/, "support"],
  [
    /functions\/(auth|sso|sso-test|instant-sso|auth-provider-credentials|recovery-codes|recovery-codes-consume|admin-reset-two-factor|sign-in-again|device-auth|invitations|invitation-magic-link|roles|team-people|api-keys|personal-api-keys|personal-key-policy|workspace-api-key-settings|origin-transfer|auth-routing|auth-errors)\.ts#/,
    "reuse-identity",
  ],
  [
    /functions\/(onboarding|onboarding-progress|bootstrap|activation|going-live|workspace)\.ts#/,
    "reuse-workspace",
  ],
  [/functions\/cloud-identity\.ts#\w*CustomDomain/, "operations"],
  [
    /functions\/(cloud-identity|owner-workspaces|ownership)\.ts#/,
    "reuse-identity",
  ],
  [/functions\/(billing|entitlement-status|plan-notice)\.ts#/, "reuse-billing"],
  [/functions\/(github-star-prompt|version)\.ts#/, "reuse-telemetry"],
  [
    /functions\/(domains-overview|help-center-domain|powered-by|workspace-wipe)\.ts#/,
    "operations",
  ],
  [
    /functions\/(feedback|merge-suggestions)\.ts#|functions\/(assistant-|copilot-events|ask-search)/,
    "assistant",
  ],
  [
    /functions\/(boards|posts|comments|post-tags|statuses|post-merge|post-views|post-owner-context|post-voters-context|moderation|roadmaps|changelog|changelog-categories|activity)\.ts#/,
    "feedback",
  ],
  [
    /functions\/(companies|company-attributes|user-attributes|blocking|teams|teammate-preferences|audit-log|test-customer)\.ts#/,
    "directory",
  ],
  [/functions\/uploads\.ts#/, "files"],
  [/functions\/widget\/(conversation|tickets)\.ts#/, "support"],
  [/functions\/widget\/help\.ts#/, "help-center"],
  [
    /functions\/widget\/|functions\/(widget-auth|widget-capabilities|widget-session-roll)\.ts#|routes\/(widget|auth\.widget-handoff)/,
    "widget",
  ],
  [
    /functions\/(portal|public-posts|public-profile|portal-access|portal-invites|portal-permissions|portal-session-token|public-cache)\.ts#|routes\/_portal/,
    "portal",
  ],
  [
    /functions\/(subscriptions|notifications|changelog-subscriptions|status-subscriptions|one-click-unsubscribe|webhooks)\.ts#/,
    "delivery",
  ],
  [
    /functions\/(conversation|conversation-[a-z]+|inbox|tickets|ticket-types|macros|sla|channel-accounts|contact-email|csat-email|customer-context|embeds|link-preview|read-batch|support-reporting)\.ts#/,
    "support",
  ],
  [/functions\/help-center/, "help-center"],
  [/functions\/(status|status-sync|external-statuses)\.ts#/, "status"],
  [
    /functions\/(integrations|integration-destinations|integration-sync|platform-credentials|external-item-search|segment-integration)\.ts#|^integrations\/|routes\/apps/,
    "integrations",
  ],
  [/functions\/(workflows|workflow-reporting)\.ts#/, "automation"],
  [/functions\/(analytics|admin-overview|visitor-analytics)\.ts#/, "reporting"],
  [/functions\/data-runs\.ts#/, "transfer"],
  [/policy\/authz-matrix/, "oos-dev"],
];

const SETTINGS_KEY =
  /^(SETTINGS_|ROLE_|API_KEY_|AUTH_|BILLING_|AUDIT_|WEBHOOK_MANAGE|INTEGRATION_MANAGE|MEMBER_MANAGE|SLA_MANAGE|BOARD_MANAGE|STATUS_MANAGE|TAG_MANAGE|CUSTOM_FIELD_MANAGE|[A-Z_]*ATTRIBUTE_MANAGE)/;

/**
 * Kaneo has five Quills actions; Quackback has about a hundred permission keys.
 * Configuration keys map to manage_settings. Content keys follow the verb.
 */
export function quillsAction(name, permissions, readOnly) {
  const settings = permissions.filter((key) => SETTINGS_KEY.test(key));
  if (
    settings.length &&
    (readOnly ? settings.length === permissions.length : true)
  )
    return "manage_settings";
  if (readOnly) return "read";
  if (/^(delete|remove|revoke|purge|wipe)/i.test(name)) return "delete";
  if (/^(create|add|import|submit|post|send)/i.test(name)) return "create";
  return "update";
}

export const READ_VERB =
  /^(list|fetch|get|search|find|check|preview|count|export|resolve|is|has|lookup|suggest|read)/i;
