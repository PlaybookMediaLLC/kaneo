// Maps Quills outbox `entityType` values (aligned with apps/api/src/quills/events.ts changeSchema)
// to the query key areas/operations they can affect. Unknown or workspace-wide entity types fall
// back to full workspace invalidation so no view goes stale.

const CONVERSATION_ENTITIES = new Set([
  "conversation",
  "conversation_message",
  "conversation_view",
  "conversation_tag",
  "conversation_attribute",
  "macro",
  "channel_account",
]);

const TICKET_ENTITIES = new Set([
  "ticket",
  "ticket_status",
  "ticket_type",
  "sla_policy",
]);

const FEEDBACK_ENTITIES = new Set([
  "post",
  "comment",
  "tag",
  "status",
  "board",
  "roadmap",
  "post_view",
  "merge_suggestion",
  "feedback_signal",
  "survey",
]);

const CHANGELOG_ENTITIES = new Set(["changelog"]);

const HELP_CENTER_ENTITIES = new Set([
  "article",
  "help_center_category",
  "redirect_rule",
]);

const STATUS_ENTITIES = new Set([
  "status_component",
  "status_group",
  "status_incident",
  "status_template",
]);

const DIRECTORY_ENTITIES = new Set([
  "principal",
  "company",
  "segment",
  "user_attribute",
  "company_attribute",
]);

const LINK_ENTITIES = new Set(["post", "board", "ticket"]);

const SCOPED_PATTERNS: ReadonlyArray<{
  entities: ReadonlySet<string>;
  areas: ReadonlySet<string>;
  operationPattern: RegExp;
}> = [
  {
    entities: CONVERSATION_ENTITIES,
    areas: new Set(["support", "notifications"]),
    operationPattern:
      /Conversation|Inbox|Message|Macro|Channel|Attribute|TeamCounts|Notification|AdminOverview|SupportReport/i,
  },
  {
    entities: TICKET_ENTITIES,
    areas: new Set(["support", "notifications"]),
    operationPattern:
      /Ticket|Inbox|Sla|Link|TeamCounts|Notification|AdminOverview|SupportReport/i,
  },
  {
    entities: FEEDBACK_ENTITIES,
    areas: new Set(["feedback", "notifications"]),
    operationPattern:
      /Post|Comment|Tag|Status|Merge|Feedback|Insight|Link|Roadmap|Signal|Survey|Demand|Revenue|Board|Moderation|TeamCounts|Notification|AdminOverview|Analytics/i,
  },
  {
    entities: CHANGELOG_ENTITIES,
    areas: new Set(["changelog"]),
    operationPattern: /Changelog|AdminOverview|Analytics/i,
  },
  {
    entities: HELP_CENTER_ENTITIES,
    areas: new Set(["help-center"]),
    operationPattern: /HelpCenter|Article|Category|Redirect|AdminOverview/i,
  },
  {
    entities: STATUS_ENTITIES,
    areas: new Set(["status"]),
    operationPattern: /Status|Incident|Component|Template|AdminOverview/i,
  },
  {
    entities: DIRECTORY_ENTITIES,
    areas: new Set(["portal"]),
    operationPattern:
      /User|Customer|Principal|Compan|Segment|Attribute|Tag|People|Demand|Revenue/i,
  },
];

/** True when `entityTypes` can affect native Kaneo↔Quills link queries (`quills-links`). */
export function affectsQuillsLinks(
  entityTypes: ReadonlySet<string | null>,
): boolean {
  for (const entityType of entityTypes) {
    if (entityType && LINK_ENTITIES.has(entityType)) return true;
  }
  return false;
}

/** True when `entityTypes` requires a full `["quills", workspaceId, userId]` invalidation. */
export function needsFullQuillsInvalidation(
  entityTypes: ReadonlySet<string | null>,
): boolean {
  if (!entityTypes.size || entityTypes.has(null)) return true;
  for (const entityType of entityTypes) {
    if (
      !entityType ||
      !SCOPED_PATTERNS.some((group) => group.entities.has(entityType))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Matches only the `["quills", workspaceId, userId, area, operation, ...]` queries affected
 * by a batch of scoped `entityTypes`.
 */
export function matchesQuillsEntityChange(
  queryKey: readonly unknown[],
  workspaceId: string,
  userId: string,
  entityTypes: ReadonlySet<string | null>,
): boolean {
  if (
    queryKey[0] !== "quills" ||
    queryKey[1] !== workspaceId ||
    queryKey[2] !== userId
  ) {
    return false;
  }
  const area = typeof queryKey[3] === "string" ? queryKey[3] : "";
  const operation = typeof queryKey[4] === "string" ? queryKey[4] : "";
  for (const entityType of entityTypes) {
    if (!entityType) return true;
    let matchedAnyGroup = false;
    for (const group of SCOPED_PATTERNS) {
      if (!group.entities.has(entityType)) continue;
      matchedAnyGroup = true;
      if (group.areas.has(area) || group.operationPattern.test(operation)) {
        return true;
      }
    }
    if (!matchedAnyGroup) return true;
  }
  return false;
}
