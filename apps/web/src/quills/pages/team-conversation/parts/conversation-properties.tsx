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
  type Priority,
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
}

const NONE = "none";
type Value = GetConversationResponse["attributes"][number]["value"];

/**
 * The right panel (design section 2): the customer, then team, priority, tags and attributes,
 * the links and the AI summary. The header holds the status and the assignee. The API has no
 * email security checks (SPF, DKIM, DMARC), so the panel has no such section.
 */
export function ConversationProperties({
  workspaceId,
  conversation,
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
  const show = (value: Value) =>
    Array.isArray(value)
      ? value.join(", ")
      : typeof value === "boolean"
        ? t(value ? "team-conversations.yes" : "team-conversations.no")
        : String(value);
  return (
    <div className="grid gap-5">
      <CustomerSection
        workspaceId={workspaceId}
        principalId={conversation.visitorPrincipalId}
        name={conversation.visitorName}
        email={conversation.visitorEmail}
      />
      <section aria-labelledby="conversation-details">
        <h2 id="conversation-details" className="mb-1 text-sm font-semibold">
          {t("team-conversations.properties.title")}
        </h2>
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
