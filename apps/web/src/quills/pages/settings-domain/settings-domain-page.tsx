import { useTranslation } from "react-i18next";
import { portalHref } from "../../core/portal-href";
import { useListCustomDomains } from "../../hooks/team/use-list-custom-domains";
import { useListSettings } from "../../hooks/team/use-list-settings";
import { useRemoveHelpCenterDomain } from "../../hooks/team/use-remove-help-center-domain";
import { useRemovePortalDomain } from "../../hooks/team/use-remove-portal-domain";
import { useSetHelpCenterDomain } from "../../hooks/team/use-set-help-center-domain";
import { useSetPortalDomain } from "../../hooks/team/use-set-portal-domain";
import { useVerifyHelpCenterDomain } from "../../hooks/team/use-verify-help-center-domain";
import { useVerifyPortalDomain } from "../../hooks/team/use-verify-portal-domain";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { SettingsPage } from "../../ui/upstream";
import { DomainSection } from "./parts/domain-section";
import { WidgetProxySnippets } from "./parts/widget-proxy-snippets";

export interface SettingsDomainPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

/**
 * Settings › Domain (settings spec B4): the custom domains of the portal and, when the
 * help center is on, of the help center. A domain serves after its DNS check.
 */
export function SettingsDomainPage({ workspaceId }: SettingsDomainPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId };
  const domains = useListCustomDomains({ param }, team.viewer);
  const settings = useListSettings({ param }, team.viewer);
  const portal = {
    set: useSetPortalDomain(team.viewer),
    verify: useVerifyPortalDomain(team.viewer),
    remove: useRemovePortalDomain(team.viewer),
  };
  const helpCenter = {
    set: useSetHelpCenterDomain(team.viewer),
    verify: useVerifyHelpCenterDomain(team.viewer),
    remove: useRemoveHelpCenterDomain(team.viewer),
  };
  const entitled = domains.data?.entitled ?? false;
  const manage = team.permissions.manageSettings;
  const find = (kind: "portal" | "help_center") =>
    domains.data?.domains.find((domain) => domain.kind === kind) ?? null;
  const host = window.location.host;
  return (
    <PageFrame
      titleKey="settings-workspace.domain.title"
      variant="app"
      landmark={false}
    >
      <SettingsPage
        title={t("settings-workspace.domain.title")}
        description={t("settings-workspace.domain.description")}
      >
        <TeamStateView
          loading={domains.isPending || settings.isPending}
          problem={domains.error ?? settings.error}
        >
          <DomainSection
            title={t("settings-workspace.domain.portal")}
            note={t("settings-workspace.domain.portalNote")}
            defaultAddress={`${host}${portalHref(workspaceId)}`}
            domain={find("portal")}
            entitled={entitled}
            manage={manage}
            onSet={(domain) =>
              portal.set.mutateAsync({ param, json: { domain } })
            }
            onVerify={() => portal.verify.mutateAsync({ param })}
            onRemove={() => portal.remove.mutateAsync({ param })}
          />
          {settings.data?.modules.helpCenter ? (
            <DomainSection
              title={t("settings-workspace.domain.helpCenter")}
              note={t("settings-workspace.domain.helpCenterNote")}
              defaultAddress={`${host}${portalHref(workspaceId, "hc")}`}
              domain={find("help_center")}
              entitled={entitled}
              manage={manage}
              onSet={(domain) =>
                helpCenter.set.mutateAsync({ param, json: { domain } })
              }
              onVerify={() => helpCenter.verify.mutateAsync({ param })}
              onRemove={() => helpCenter.remove.mutateAsync({ param })}
            />
          ) : null}
          <WidgetProxySnippets workspaceId={workspaceId} />
        </TeamStateView>
      </SettingsPage>
    </PageFrame>
  );
}
