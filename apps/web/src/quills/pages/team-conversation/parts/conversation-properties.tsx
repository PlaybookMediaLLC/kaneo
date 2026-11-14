import { useTranslation } from "react-i18next";
import type { GetConversationResponse } from "../../../api/team/get-conversation";
import { useAssignConversationTeam } from "../../../hooks/team/use-assign-conversation-team";
import { useListConversationAttributes } from "../../../hooks/team/use-list-conversation-attributes";
import { useListTeams } from "../../../hooks/team/use-list-teams";
import { useSetConversationPriority } from "../../../hooks/team/use-set-conversation-priority";
import { useTeamRuntime } from "../../../team/runtime";
import { PropertyRow } from "../../../ui/inbox/property-row";
import {
  priorities,
  priorityKeys,
  statusKeys,
  type Priority,
  type Teammate,
} from "../../team-conversations/conversation-list";
import { ActionProblem } from "./action-problem";
import { CustomerSection } from "./customer-section";
import { LinksSection } from "./links-section";
import { PropertySelect } from "./property-select";
import { SummarySection } from "./summary-section";
import { TagEditor } from "./tag-editor";

export interface ConversationPropertiesProps {
  workspaceId: string;
  conversation: GetConversationResponse;
  people: readonly Teammate[];
}

const NONE = "none";
type Value = GetConversationResponse["attributes"][number]["value"];

/** The properties panel: state, team, priority, tags, attributes, the customer, links and the AI summary. */
export function ConversationProperties({
  workspaceId,
  conversation,
  people,
}: ConversationPropertiesProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId, conversationId: conversation.id };
  const teams = useListTeams({ param: { workspaceId } }, team.viewer);
  const definitions = useListConversationAttributes(
    { param: { workspaceId }, query: {} },
    team.viewer,
  );
  const assignTeam = useAssignConversationTeam(team.viewer);
  const priority = useSetConversationPriority(team.viewer);
  const locked = !team.permissions.update;
  const assignee = conversation.assignedAgentPrincipalId
    ? people.find(
        (person) => person.id === conversation.assignedAgentPrincipalId,
      )
    : undefined;
  const show = (value: Value) =>
    Array.isArray(value)
      ? value.join(", ")
      : typeof value === "boolean"
        ? t(value ? "team-conversations.yes" : "team-conversations.no")
        : String(value);
  return (
    <div className="grid gap-5">
      <section>
        <PropertyRow label={t("team-conversations.properties.status")}>
          {t(statusKeys[conversation.status])}
        </PropertyRow>
        <PropertyRow label={t("team-conversations.properties.assignee")}>
          {conversation.assignedAgentPrincipalId
            ? (assignee?.name ?? t("team-conversations.unknown"))
            : t("team-conversations.unassigned")}
        </PropertyRow>
        <PropertyRow label={t("team-conversations.properties.team")}>
          <PropertySelect
            label={t("team-conversations.properties.team")}
            value={conversation.assignedTeamId ?? NONE}
            disabled={locked || assignTeam.isPending}
            options={[
              { value: NONE, label: t("team-conversations.noTeam") },
              ...(teams.data?.teams ?? []).map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
            onChange={(value) =>
              assignTeam.mutate({
                param,
                json: { teamId: value === NONE ? null : value },
              })
            }
          />
        </PropertyRow>
        <PropertyRow label={t("team-conversations.properties.priority")}>
          <PropertySelect
            label={t("team-conversations.properties.priority")}
            value={conversation.priority}
            disabled={locked || priority.isPending}
            options={priorities.map((value) => ({
              value,
              label: t(priorityKeys[value]),
            }))}
            onChange={(value) =>
              priority.mutate({ param, json: { priority: value as Priority } })
            }
          />
        </PropertyRow>
        <PropertyRow label={t("team-conversations.properties.tags")}>
          <TagEditor
            workspaceId={workspaceId}
            conversationId={conversation.id}
            tags={conversation.tags}
          />
        </PropertyRow>
        {conversation.attributes
          .filter((attribute) => attribute.value !== null)
          .map((attribute) => (
            <PropertyRow
              key={attribute.key}
              label={
                definitions.data?.items.find(
                  (item) => item.key === attribute.key,
                )?.label ?? attribute.key
              }
            >
              {show(attribute.value)}
            </PropertyRow>
          ))}
        <ActionProblem problem={assignTeam.error ?? priority.error ?? null} />
      </section>
      <CustomerSection
        workspaceId={workspaceId}
        principalId={conversation.visitorPrincipalId}
        name={conversation.visitorName}
        email={conversation.visitorEmail}
      />
      <LinksSection
        workspaceId={workspaceId}
        conversationId={conversation.id}
      />
      <SummarySection
        workspaceId={workspaceId}
        conversationId={conversation.id}
        summary={conversation.summary}
      />
    </div>
  );
}
