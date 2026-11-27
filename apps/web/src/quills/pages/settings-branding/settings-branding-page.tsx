import { useTranslation } from "react-i18next";
import type { UpdateBrandingSettingsRequest } from "../../api/team/update-branding-settings";
import type { PortalProblem } from "../../core/types";
import { useGetPublicPortalConfig } from "../../hooks/portal/use-get-public-portal-config";
import { useGetBrandingSettings } from "../../hooks/team/use-get-branding-settings";
import { useGetPoweredBy } from "../../hooks/team/use-get-powered-by";
import { useListCustomDomains } from "../../hooks/team/use-list-custom-domains";
import { useSetPoweredBy } from "../../hooks/team/use-set-powered-by";
import { useUpdateBrandingSettings } from "../../hooks/team/use-update-branding-settings";
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
  toast,
} from "../../ui/upstream";
import { AppearanceSection } from "./parts/appearance-section";
import { BrandForm } from "./parts/brand-form";
import { EmailTemplateEditor } from "./parts/email-template-editor";

export interface SettingsBrandingPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/**
 * Settings › Branding (settings spec B2): the logo, the brand name, the colors of the
 * portal and the "Powered by" badge. The workspace name itself is Kaneo data.
 */
export function SettingsBrandingPage({
  workspaceId,
}: SettingsBrandingPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId };
  const branding = useGetBrandingSettings({ param }, team.viewer);
  // No teammate route returns the logo URL, so the public portal config gives it.
  const config = useGetPublicPortalConfig(
    { param: { workspace: workspaceId } },
    team.viewer,
  );
  const poweredBy = useGetPoweredBy({ param }, team.viewer);
  // `entitled` is the plan state that "Hide Powered by" needs.
  const domains = useListCustomDomains({ param }, team.viewer);
  const update = useUpdateBrandingSettings(team.viewer);
  const setPoweredBy = useSetPoweredBy(team.viewer);
  const disabled = !team.permissions.manageSettings;
  const save = async (json: UpdateBrandingSettingsRequest["json"]) => {
    await update.mutateAsync({ param, json });
  };
  const shown = poweredBy.data?.showPoweredBy ?? true;
  return (
    <PageFrame
      titleKey="settings-workspace.branding.title"
      variant="app"
      landmark={false}
    >
      <SettingsPage
        title={t("settings-workspace.branding.title")}
        description={t("settings-workspace.branding.description")}
      >
        <TeamStateView
          loading={
            branding.isPending || poweredBy.isPending || config.isPending
          }
          // The logo is not needed to change the other settings: a failed config read hides only the logo.
          problem={branding.error ?? poweredBy.error}
        >
          {branding.data ? (
            <>
              <SettingsSection title={t("settings-workspace.branding.brand")}>
                <BrandForm
                  workspaceId={workspaceId}
                  name={config.data?.name ?? ""}
                  headerDisplayName={branding.data.headerDisplayName}
                  logoUrl={config.data?.branding.logoUrl ?? null}
                  disabled={disabled}
                  onLogoChanged={() => config.refetch()}
                  onSubmit={async ({ headerDisplayName }) => {
                    try {
                      await save({
                        headerDisplayName: headerDisplayName || null,
                      });
                      toast.success(t("settings-workspace.branding.saved"));
                    } catch (error) {
                      return error as PortalProblem;
                    }
                  }}
                >
                  <SettingsRow
                    title={t("settings-workspace.branding.header")}
                    description={t("settings-workspace.branding.headerText")}
                  >
                    <SettingSelect
                      label={t("settings-workspace.branding.header")}
                      value={branding.data.headerDisplayMode}
                      placeholder={t(
                        "settings-workspace.branding.headerCustom",
                      )}
                      options={[
                        {
                          value: "logo_and_name",
                          label: t("settings-workspace.branding.logoAndName"),
                        },
                        {
                          value: "logo_only",
                          label: t("settings-workspace.branding.logoOnly"),
                        },
                      ]}
                      disabled={disabled}
                      onValueChange={(mode) =>
                        save({
                          headerDisplayMode:
                            mode === "logo_only"
                              ? "logo_only"
                              : "logo_and_name",
                        })
                      }
                    />
                  </SettingsRow>
                </BrandForm>
              </SettingsSection>
              <AppearanceSection
                theme={branding.data.theme}
                disabled={disabled}
                onSave={(theme) => save({ theme })}
              />
              <SettingsSection
                title={t("settings-workspace.branding.publicBoard")}
              >
                <SettingsCard>
                  <SettingSwitchRow
                    title={t("settings-workspace.branding.hidePoweredBy")}
                    description={t(
                      "settings-workspace.branding.hidePoweredByText",
                    )}
                    checked={!shown}
                    disabled={disabled}
                    // Only hiding needs a plan. Showing the badge again is always allowed.
                    locked={
                      domains.data?.entitled === false && shown
                        ? t("settings-workspace.branding.needsPlan")
                        : undefined
                    }
                    onCheckedChange={async (hide) => {
                      await setPoweredBy.mutateAsync({
                        param,
                        json: { showPoweredBy: !hide },
                      });
                    }}
                  />
                </SettingsCard>
              </SettingsSection>
              <EmailTemplateEditor
                workspaceId={workspaceId}
                brandName={
                  branding.data.headerDisplayName ?? config.data?.name ?? ""
                }
                disabled={disabled}
              />
            </>
          ) : null}
        </TeamStateView>
      </SettingsPage>
    </PageFrame>
  );
}
