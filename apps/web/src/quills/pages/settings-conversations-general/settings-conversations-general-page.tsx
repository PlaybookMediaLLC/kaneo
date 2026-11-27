import { useTranslation } from "react-i18next";
import { useGetAwayReply } from "../../hooks/team/use-get-away-reply";
import { useGetConversationRouting } from "../../hooks/team/use-get-conversation-routing";
import { useGetDefaultSlaPolicy } from "../../hooks/team/use-get-default-sla-policy";
import { useGetEmailAutoAck } from "../../hooks/team/use-get-email-auto-ack";
import { useGetOfficeHours } from "../../hooks/team/use-get-office-hours";
import { useGetPortalSettings } from "../../hooks/team/use-get-portal-settings";
import { useGetWorkflowAbandonedAutoClose } from "../../hooks/team/use-get-workflow-abandoned-auto-close";
import { useGetWorkflowCloseSpam } from "../../hooks/team/use-get-workflow-close-spam";
import { useListSlaPolicyOptions } from "../../hooks/team/use-list-sla-policy-options";
import {
  useGetUndoSendSettings,
  useSetUndoSendSettings,
} from "../../hooks/team/use-scheduled-send";
import { useSetDefaultSlaPolicy } from "../../hooks/team/use-set-default-sla-policy";
import { useUpdatePortalSettings } from "../../hooks/team/use-update-portal-settings";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { SettingSelect } from "../../ui/setting-select";
import { SettingSwitchRow } from "../../ui/setting-switch-row";
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "../../ui/upstream";
import { AutomationSection } from "./parts/automation-section";
import { OfficeHoursSection } from "./parts/office-hours-section";

export interface SettingsConversationsGeneralPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

// A Select needs a string value. No policy ID has this value.
const none = "none";
const UNDO_DELAY_OPTIONS = [5, 10, 15, 20, 30] as const;

/** Settings › Conversations › General (settings spec B12): hours, automation, SLA and portal. */
export function SettingsConversationsGeneralPage({
  workspaceId,
}: SettingsConversationsGeneralPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const input = { param: { workspaceId } };
  const queries = [
    useGetOfficeHours(input, team.viewer),
    useGetConversationRouting(input, team.viewer),
    useGetEmailAutoAck(input, team.viewer),
    useGetWorkflowAbandonedAutoClose(input, team.viewer),
    useGetWorkflowCloseSpam(input, team.viewer),
    useGetDefaultSlaPolicy(input, team.viewer),
    useListSlaPolicyOptions(input, team.viewer),
    useGetPortalSettings(input, team.viewer),
    useGetAwayReply(input, team.viewer),
    useGetUndoSendSettings(input, team.viewer),
  ] as const;
  const [
    hours,
    routing,
    autoAck,
    abandoned,
    closeSpam,
    sla,
    policies,
    portal,
    away,
    undoSend,
  ] = queries;
  const setSla = useSetDefaultSlaPolicy(team.viewer);
  const setUndoSend = useSetUndoSendSettings(team.viewer);
  const update = useUpdatePortalSettings(team.viewer);
  const locked = !team.permissions.manageSettings;
  const undoConfig = undoSend.data ?? { enabled: false, delaySeconds: 10 };
  return (
    <PageFrame
      titleKey="settings-conversations.general.title"
      variant="app"
      landmark={false}
    >
      <SettingsPage
        title={t("settings-conversations.general.title")}
        description={t("settings-conversations.general.description")}
      >
        <TeamStateView
          loading={queries.some((query) => query.isPending)}
          problem={queries.find((query) => query.error)?.error}
        >
          {hours.data ? (
            <OfficeHoursSection workspaceId={workspaceId} hours={hours.data} />
          ) : null}
          <AutomationSection
            workspaceId={workspaceId}
            routing={routing.data?.enabled ?? false}
            autoAck={autoAck.data?.enabled ?? false}
            awayReply={away.data ?? { enabled: false, message: "" }}
            abandoned={abandoned.data ?? { enabled: false, waitMinutes: 5 }}
            closeSpam={closeSpam.data?.enabled ?? false}
          />
          <SettingsSection title={t("settings-conversations.general.service")}>
            <SettingsCard>
              <SettingSwitchRow
                title={t("settings-conversations.general.undoSend")}
                description={t("settings-conversations.general.undoSendText")}
                checked={undoConfig.enabled}
                disabled={locked}
                onCheckedChange={async (enabled) => {
                  await setUndoSend.mutateAsync({
                    ...input,
                    json: {
                      enabled,
                      delaySeconds: undoConfig.delaySeconds,
                    },
                  });
                }}
              />
              {undoConfig.enabled ? (
                <SettingsRow
                  title={t("settings-conversations.general.undoSendDelay")}
                  description={t(
                    "settings-conversations.general.undoSendDelayText",
                  )}
                >
                  <SettingSelect
                    label={t("settings-conversations.general.undoSendDelay")}
                    value={String(undoConfig.delaySeconds)}
                    options={UNDO_DELAY_OPTIONS.map((seconds) => ({
                      value: String(seconds),
                      label: t(
                        "settings-conversations.general.undoSendSeconds",
                        { count: seconds },
                      ),
                    }))}
                    disabled={locked}
                    onValueChange={async (next) => {
                      await setUndoSend.mutateAsync({
                        ...input,
                        json: {
                          enabled: undoConfig.enabled,
                          delaySeconds: Number(next),
                        },
                      });
                    }}
                  />
                </SettingsRow>
              ) : null}
              <SettingsRow
                title={t("settings-conversations.general.sla")}
                description={t("settings-conversations.general.slaText")}
              >
                <SettingSelect
                  label={t("settings-conversations.general.sla")}
                  value={sla.data?.policyId ?? none}
                  options={[
                    {
                      value: none,
                      label: t("settings-conversations.general.noSla"),
                    },
                    ...(policies.data?.items ?? []).map((policy) => ({
                      value: policy.id,
                      label: policy.name,
                    })),
                  ]}
                  disabled={locked}
                  onValueChange={async (next) => {
                    await setSla.mutateAsync({
                      ...input,
                      json: { policyId: next === none ? null : next },
                    });
                  }}
                />
              </SettingsRow>
              <SettingSwitchRow
                title={t("settings-conversations.general.portal")}
                description={t("settings-conversations.general.portalText")}
                checked={portal.data?.supportEnabled ?? false}
                disabled={locked}
                onCheckedChange={async (supportEnabled) => {
                  await update.mutateAsync({
                    ...input,
                    json: { supportEnabled },
                  });
                }}
              />
            </SettingsCard>
          </SettingsSection>
        </TeamStateView>
      </SettingsPage>
    </PageFrame>
  );
}
