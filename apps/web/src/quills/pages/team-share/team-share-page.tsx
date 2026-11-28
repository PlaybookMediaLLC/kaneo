import { resolveApiBaseUrl } from "@kaneo/libs";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useGetPortalSettings } from "../../hooks/team/use-get-portal-settings";
import { useListCustomDomains } from "../../hooks/team/use-list-custom-domains";
import { useListSettings } from "../../hooks/team/use-list-settings";
import { useUpdatePortalSettings } from "../../hooks/team/use-update-portal-settings";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import {
  authClient,
  SettingsPage,
  SettingsSection,
  toast,
} from "../../ui/upstream";
import { CollectCard } from "./parts/collect-card";
import { EmailSignature } from "./parts/email-signature";
import { ReadyMessages } from "./parts/ready-messages";
import { SiteLinksCard } from "./parts/site-links-card";
import { SocialLinks } from "./parts/social-links";
import { WidgetEmbed } from "./parts/widget-embed";
import { portalUrl, siteLinks } from "./share-links";

export interface TeamSharePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

const label = (text: string): ReactNode => (
  <span className="text-sm font-medium text-foreground">{text}</span>
);

/**
 * Ways to share the portal (settings spec A5). The custom domain and the portal navigation
 * need manage_settings; without it the page uses the portal path and every enabled module.
 */
export function TeamSharePage({ workspaceId }: TeamSharePageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const manage = team.permissions.manageSettings;
  const settings = useListSettings({ param: { workspaceId } }, team.viewer);
  // An empty workspace ID keeps a read off that the caller may not make.
  const managed = { param: { workspaceId: manage ? workspaceId : "" } };
  const portal = useGetPortalSettings(managed, team.viewer);
  const domains = useListCustomDomains(managed, team.viewer);
  const update = useUpdatePortalSettings(team.viewer);
  const session = authClient.useSession();
  const origin = window.location.origin;
  const url = portalUrl(workspaceId, origin, domains.data?.domains);
  const api = resolveApiBaseUrl(import.meta.env.VITE_API_URL);
  const data = settings.data;
  const hasData = Boolean(data);
  const name = data?.name ?? "";
  const scrolledRef = useRef<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash;
    if (hash !== "#widget-embed") {
      scrolledRef.current = null;
      return;
    }
    if (!hasData) return;
    const key = `${workspaceId}:${hash}`;
    if (scrolledRef.current === key) return;
    scrolledRef.current = key;
    document.getElementById("widget-embed")?.scrollIntoView?.();
  }, [hasData, workspaceId]);
  return (
    <PageFrame titleKey="team-share.title" variant="app" landmark={false}>
      <SettingsPage
        title={t("team-share.title")}
        description={t("team-share.description")}
      >
        <TeamStateView
          loading={settings.isLoading}
          problem={settings.error}
          onRetry={() => void settings.refetch()}
        >
          {data ? (
            <>
              <SettingsSection
                title={t("team-share.collect.title")}
                description={t("team-share.collect.text", { name })}
              >
                <CollectCard
                  workspace={name}
                  url={url}
                  live={portal.data?.enabled}
                  turningOn={update.isPending}
                  onTurnOn={() =>
                    update.mutate(
                      { param: { workspaceId }, json: { enabled: true } },
                      {
                        onError: () =>
                          toast.error(t("team-share.collect.turnOnFailed")),
                      },
                    )
                  }
                />
              </SettingsSection>
              <SettingsSection
                title={label(t("team-share.social.title"))}
                description={t("team-share.social.text")}
              >
                <SocialLinks workspace={name} url={url} />
              </SettingsSection>
              <SettingsSection
                title={label(t("team-share.signature.title"))}
                description={t("team-share.signature.text")}
              >
                <EmailSignature
                  workspace={name}
                  url={url}
                  user={session.data?.user ?? { name: "" }}
                />
              </SettingsSection>
              <SettingsSection
                title={label(t("team-share.site.title"))}
                description={t("team-share.site.text")}
              >
                <SiteLinksCard
                  workspace={name}
                  links={siteLinks(url, data.modules, portal.data?.nav)}
                />
              </SettingsSection>
              <SettingsSection
                title={label(t("team-share.messages.title"))}
                description={t("team-share.messages.text")}
              >
                <ReadyMessages workspace={name} url={url} />
              </SettingsSection>
              <div id="widget-embed">
                <SettingsSection
                  title={label(t("team-share.widget.title"))}
                  description={t("team-share.widget.text")}
                >
                  <WidgetEmbed
                    workspaceId={workspaceId}
                    slug={data.slug || workspaceId}
                    apiBase={new URL(api, origin).href.replace(/\/+$/, "")}
                    canMintCode={manage}
                  />
                </SettingsSection>
              </div>
            </>
          ) : null}
        </TeamStateView>
      </SettingsPage>
    </PageFrame>
  );
}
