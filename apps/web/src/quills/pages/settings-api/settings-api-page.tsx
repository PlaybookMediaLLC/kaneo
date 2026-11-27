import { useTranslation } from "react-i18next";
import type { UpdateDeveloperSettingsRequest } from "../../api/team/update-developer-settings";
import { useGetDeveloperSettings } from "../../hooks/team/use-get-developer-settings";
import { useUpdateDeveloperSettings } from "../../hooks/team/use-update-developer-settings";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { SettingSwitchRow } from "../../ui/setting-switch-row";
import {
  ApiKeysSettings,
  SettingsCard,
  SettingsNote,
  SettingsSection,
} from "../../ui/upstream";
import { WebhookDeliveriesSection } from "./parts/webhook-deliveries-panel";

export interface SettingsApiPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

type Field = keyof UpdateDeveloperSettingsRequest["json"];

const switches: readonly { field: Field; title: string; text: string }[] = [
  {
    field: "mcpEnabled",
    title: "settings-connections.api.mcp",
    text: "settings-connections.api.mcpText",
  },
  {
    field: "mcpPortalAccessEnabled",
    title: "settings-connections.api.mcpPortal",
    text: "settings-connections.api.mcpPortalText",
  },
  {
    field: "oauthDynamicClientRegistrationEnabled",
    title: "settings-connections.api.oauth",
    text: "settings-connections.api.oauthText",
  },
  {
    field: "personalApiKeysEnabled",
    title: "settings-connections.api.personalKeys",
    text: "settings-connections.api.personalKeysText",
  },
];

/**
 * Settings › API (settings spec B11): Kaneo's API keys of the signed-in user, then the
 * workspace switches for developer access to Quills.
 */
export function SettingsApiPage({ workspaceId }: SettingsApiPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId };
  const settings = useGetDeveloperSettings({ param }, team.viewer);
  const update = useUpdateDeveloperSettings(team.viewer);
  return (
    <PageFrame
      titleKey="settings-connections.api.title"
      variant="app"
      landmark={false}
    >
      <ApiKeysSettings />
      <div className="mx-auto w-full max-w-3xl space-y-10 px-4 pb-10 sm:px-8">
        <SettingsNote>{t("settings-connections.api.keysOwner")}</SettingsNote>
        <SettingsSection
          title={t("settings-connections.api.developer")}
          description={t("settings-connections.api.developerText")}
        >
          <TeamStateView loading={settings.isPending} problem={settings.error}>
            <SettingsCard>
              {switches.map(({ field, title, text }) => (
                <SettingSwitchRow
                  key={field}
                  title={t(title)}
                  description={t(text)}
                  checked={settings.data?.[field] ?? false}
                  disabled={!team.permissions.manageSettings}
                  onCheckedChange={async (next) => {
                    await update.mutateAsync({
                      param,
                      json: { [field]: next },
                    });
                  }}
                />
              ))}
            </SettingsCard>
          </TeamStateView>
          <SettingsNote>
            {t("settings-connections.api.developerNote")}
          </SettingsNote>
        </SettingsSection>
        <WebhookDeliveriesSection
          workspaceId={workspaceId}
          disabled={!team.permissions.manageSettings}
        />
      </div>
    </PageFrame>
  );
}
