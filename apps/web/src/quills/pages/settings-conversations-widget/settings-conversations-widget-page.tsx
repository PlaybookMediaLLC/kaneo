import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { UpdateWidgetSettingsRequest } from "../../api/team/update-widget-settings";
import { problemOf } from "../../core/problem-of";
import { useGetWidgetSettings } from "../../hooks/team/use-get-widget-settings";
import { useUpdateWidgetSettings } from "../../hooks/team/use-update-widget-settings";
import { useTeamRuntime } from "../../team/runtime";
import { teamHref } from "../../team/team-href";
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
import { HomeSection } from "./parts/home-section";
import { LauncherForm } from "./parts/launcher-form";
import { ReplyTimeRow } from "./parts/reply-time-row";

export interface SettingsConversationsWidgetPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

type Patch = UpdateWidgetSettingsRequest["json"];
type Tab = "home" | "messenger" | "feedback" | "changelog" | "help" | "tickets";
const tabs: readonly [Tab, string][] = [
  ["home", "settings-conversations.widget.tabs.home"],
  ["messenger", "settings-conversations.widget.tabs.messenger"],
  ["feedback", "settings-conversations.widget.tabs.feedback"],
  ["changelog", "settings-conversations.widget.tabs.changelog"],
  ["help", "settings-conversations.widget.tabs.help"],
  ["tickets", "settings-conversations.widget.tabs.tickets"],
];
const visitor: readonly [
  "visitorAnalytics" | "visitorDeviceTracking",
  string,
  string,
][] = [
  [
    "visitorAnalytics",
    "settings-conversations.widget.analytics",
    "settings-conversations.widget.analyticsText",
  ],
  [
    "visitorDeviceTracking",
    "settings-conversations.widget.device",
    "settings-conversations.widget.deviceText",
  ],
];

/** Settings › Widget (settings spec B12): the widget, its launcher, tabs, Home and visitor data. */
export function SettingsConversationsWidgetPage({
  workspaceId,
}: SettingsConversationsWidgetPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId };
  const settings = useGetWidgetSettings({ param }, team.viewer);
  const update = useUpdateWidgetSettings(team.viewer);
  const data = settings.data;
  const locked = !team.permissions.manageSettings;
  const save = async (json: Patch) => {
    await update.mutateAsync({ param, json });
  };
  return (
    <PageFrame
      titleKey="settings-conversations.widget.title"
      variant="app"
      landmark={false}
    >
      <SettingsPage
        title={t("settings-conversations.widget.title")}
        description={t("settings-conversations.widget.description")}
      >
        <TeamStateView loading={settings.isPending} problem={settings.error}>
          {data ? (
            <>
              <SettingsSection>
                <SettingsCard>
                  <SettingSwitchRow
                    title={t("settings-conversations.widget.enabled")}
                    description={t("settings-conversations.widget.enabledText")}
                    checked={data.enabled}
                    disabled={locked}
                    onCheckedChange={(enabled) => save({ enabled })}
                  />
                  <SettingsRow
                    title={t("settings-conversations.widget.position")}
                    description={t(
                      "settings-conversations.widget.positionText",
                    )}
                  >
                    <SettingSelect
                      label={t("settings-conversations.widget.position")}
                      value={
                        data.position === "bottom-left"
                          ? "bottom-left"
                          : "bottom-right"
                      }
                      options={[
                        {
                          value: "bottom-right",
                          label: t("settings-conversations.widget.right"),
                        },
                        {
                          value: "bottom-left",
                          label: t("settings-conversations.widget.left"),
                        },
                      ]}
                      disabled={locked}
                      onValueChange={(position) => save({ position })}
                    />
                  </SettingsRow>
                  <ReplyTimeRow
                    value={data.replyTime}
                    disabled={locked}
                    onChange={(replyTime) => save({ replyTime })}
                  />
                  {locked ? null : (
                    <LauncherForm
                      values={{
                        launcherLabel: data.launcherLabel,
                        launcherGreeting: data.launcherGreeting,
                      }}
                      onSubmit={(values) => problemOf(save(values))}
                    />
                  )}
                  <SettingsRow
                    title={t("settings-conversations.widget.install")}
                    description={t("settings-conversations.widget.installText")}
                  >
                    <Link
                      to={teamHref(workspaceId, "/share")}
                      hash="widget-embed"
                      className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("settings-conversations.widget.installAction")}
                    </Link>
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>
              <SettingsSection
                title={t("settings-conversations.widget.tabsTitle")}
              >
                <SettingsCard>
                  {tabs.map(([tab, key]) => (
                    <SettingSwitchRow
                      key={tab}
                      title={t(key)}
                      checked={data.tabs[tab]}
                      disabled={locked}
                      onCheckedChange={(next) =>
                        save({ tabs: { [tab]: next } })
                      }
                    />
                  ))}
                </SettingsCard>
              </SettingsSection>
              <HomeSection
                workspaceId={workspaceId}
                home={data.home}
                locked={locked}
                onSave={(home) => save({ home })}
              />
              <SettingsSection
                title={t("settings-conversations.widget.visitors")}
              >
                <SettingsCard>
                  {visitor.map(([field, title, text]) => (
                    <SettingSwitchRow
                      key={field}
                      title={t(title)}
                      description={t(text)}
                      checked={data[field]}
                      disabled={locked}
                      onCheckedChange={(next) => save({ [field]: next })}
                    />
                  ))}
                </SettingsCard>
              </SettingsSection>
            </>
          ) : null}
        </TeamStateView>
      </SettingsPage>
    </PageFrame>
  );
}
