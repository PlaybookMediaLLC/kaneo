import { useTranslation } from "react-i18next";
import type { GetConversationResponse } from "../../../api/team/get-conversation";
import { relativeTime } from "../../../core/relative-time";
import { useAssignConversation } from "../../../hooks/team/use-assign-conversation";
import { useSetConversationStatus } from "../../../hooks/team/use-set-conversation-status";
import { useTeamRuntime } from "../../../team/runtime";
import { PersonAvatar } from "../../../ui/person-avatar";
import {
  conversationStatuses,
  statusKeys,
  type ConversationStatus,
  type Teammate,
} from "../../team-conversations/conversation-list";
import { ActionProblem } from "./action-problem";
import { PropertySelect } from "./property-select";

export interface ConversationHeaderProps {
  workspaceId: string;
  /** Undefined while the conversation loads: the heading still shows, so focus can land on it. */
  conversation?: GetConversationResponse;
  people: readonly Teammate[];
}

const NOBODY = "none";
const channelKeys: Record<string, string> = {
  messenger: "team-conversations.channel.messenger",
  email: "team-conversations.channel.email",
  github: "team-conversations.channel.github",
};

/** The item header: the subject, the customer, the source and time, and the status and assignee pickers. */
export function ConversationHeader({
  workspaceId,
  conversation,
  people,
}: ConversationHeaderProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const status = useSetConversationStatus(team.viewer);
  const assign = useAssignConversation(team.viewer);
  const param = { workspaceId, conversationId: conversation?.id ?? "" };
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h1 tabIndex={-1} className="text-lg font-semibold outline-none">
          {conversation?.subject ||
            conversation?.lastMessagePreview ||
            t("team-conversations.conversation")}
        </h1>
        {conversation ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <PersonAvatar
              name={conversation.visitorName ?? conversation.visitorEmail}
            />
            <span className="text-foreground">
              {conversation.visitorName ??
                conversation.visitorEmail ??
                t("team-conversations.unknown")}
            </span>
            <span>
              {channelKeys[conversation.channel]
                ? t(channelKeys[conversation.channel]!)
                : conversation.channel}
            </span>
            <time dateTime={conversation.createdAt}>
              {relativeTime(conversation.createdAt, i18n.language)}
            </time>
          </p>
        ) : null}
        <ActionProblem problem={status.error ?? assign.error ?? null} />
      </div>
      {conversation ? (
        <div className="flex flex-wrap items-center gap-2">
          <PropertySelect
            label={t("team-conversations.properties.status")}
            value={conversation.status}
            disabled={!team.permissions.update || status.isPending}
            options={conversationStatuses.map((value) => ({
              value,
              label: t(statusKeys[value]),
            }))}
            onChange={(value) => {
              assign.reset();
              status.mutate({
                param,
                json: { status: value as ConversationStatus },
              });
            }}
          />
          <PropertySelect
            label={t("team-conversations.properties.assignee")}
            value={conversation.assignedAgentPrincipalId ?? NOBODY}
            disabled={!team.permissions.update || assign.isPending}
            options={[
              { value: NOBODY, label: t("team-conversations.unassigned") },
              ...people.map((person) => ({
                value: person.id,
                label: person.name ?? t("team-conversations.unknown"),
              })),
            ]}
            onChange={(value) => {
              status.reset();
              assign.mutate({
                param,
                json: { assigneePrincipalId: value === NOBODY ? null : value },
              });
            }}
          />
        </div>
      ) : null}
    </header>
  );
}
