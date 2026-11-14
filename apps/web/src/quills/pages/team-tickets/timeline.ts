import type { ListTicketActivityResponse } from "../../api/team/list-ticket-activity";
import type { ListTicketMessagesResponse } from "../../api/team/list-ticket-messages";
import { PRIORITY_KEYS } from "./ticket-scope";

export type TicketMessage = ListTicketMessagesResponse["items"][number];
export type TicketActivity = ListTicketActivityResponse["items"][number];
export type TimelineEntry =
  | { kind: "message"; id: string; at: string; message: TicketMessage }
  | { kind: "activity"; id: string; at: string; activity: TicketActivity };

type Translate = (key: string, values?: Record<string, string>) => string;

/** The messages, the notes and the activity of a ticket in one list, oldest first. */
export const timeline = (
  messages: readonly TicketMessage[],
  activity: readonly TicketActivity[],
): TimelineEntry[] =>
  [
    ...messages.map((message) => ({
      kind: "message" as const,
      id: `message:${message.id}`,
      at: message.createdAt,
      message,
    })),
    ...activity.map((item) => ({
      kind: "activity" as const,
      id: `activity:${item.id}`,
      at: item.createdAt,
      activity: item,
    })),
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

const priority = (value: string | null | undefined, t: Translate) =>
  value && value in PRIORITY_KEYS
    ? t(PRIORITY_KEYS[value as keyof typeof PRIORITY_KEYS])
    : (value ?? "");

/** One line about a change. An unknown kind of change gets a general line. */
export function activityText(item: TicketActivity, t: Translate) {
  const someone = t("team-tickets.activity.someone");
  const actor = item.actorName ?? someone;
  const { metadata } = item;
  switch (item.type) {
    case "ticket.created":
      return t("team-tickets.activity.created", { actor });
    // quills-web-allow C4: "status.changed" is an API activity type, not a translation key.
    case "status.changed":
      return t("team-tickets.activity.status", {
        actor,
        from: metadata.fromName ?? "",
        to: metadata.toName ?? "",
      });
    case "priority.changed":
      return t("team-tickets.activity.priority", {
        actor,
        from: priority(metadata.from, t),
        to: priority(metadata.to, t),
      });
    case "ticket.assigned": {
      // The metadata names only what moved: the teammate, the team or both.
      const name = metadata.toPrincipalId
        ? (metadata.toPrincipalName ?? someone)
        : metadata.toTeamId
          ? (metadata.toTeamName ?? someone)
          : null;
      return name
        ? t("team-tickets.activity.assigned", { actor, name })
        : t("team-tickets.activity.unassigned", { actor });
    }
    default:
      return t("team-tickets.activity.updated", { actor });
  }
}
