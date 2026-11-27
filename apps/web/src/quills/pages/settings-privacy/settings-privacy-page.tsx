import { useTranslation } from "react-i18next";
import { problemOf } from "../../core/problem-of";
import { useGetPortalSettings } from "../../hooks/team/use-get-portal-settings";
import { useSetModerationDefault } from "../../hooks/team/use-set-moderation-default";
import { useUpdatePortalAccess } from "../../hooks/team/use-update-portal-access";
import { useUpdatePortalSettings } from "../../hooks/team/use-update-portal-settings";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
import { SettingSelect } from "../../ui/setting-select";
import { SettingSwitchRow } from "../../ui/setting-switch-row";
import {
  SettingsCard,
  SettingsNote,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "../../ui/upstream";
import { DomainsForm } from "./parts/domains-form";
import { RetentionSection } from "./parts/retention-section";
import { SignInSection } from "./parts/sign-in-section";

export interface SettingsPrivacyPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

type Approval = "none" | "anonymous" | "authenticated" | "all";
const approvals: readonly [Approval, string][] = [
  ["none", "settings-product.privacy.approval.none"],
  ["anonymous", "settings-product.privacy.approval.anonymous"],
  ["authenticated", "settings-product.privacy.approval.authenticated"],
  ["all", "settings-product.privacy.approval.all"],
];

/** Settings › Privacy & Access (settings spec B7): who may post, review, and portal access. */
export function SettingsPrivacyPage({ workspaceId }: SettingsPrivacyPageProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const param = { workspaceId };
  const portal = useGetPortalSettings({ param }, team.viewer);
  const update = useUpdatePortalSettings(team.viewer);
  const moderation = useSetModerationDefault(team.viewer);
  const access = useUpdatePortalAccess(team.viewer);
  const locked = !team.permissions.manageSettings;
  const data = portal.data;
  const visibility =
    data?.access.visibility === "private" ? "private" : "public";
  return (
    <PageFrame
      titleKey="settings-product.privacy.title"
      variant="app"
      landmark={false}
    >
      <SettingsPage
        title={t("settings-product.privacy.title")}
        description={t("settings-product.privacy.description")}
      >
        <TeamStateView loading={portal.isPending} problem={portal.error}>
          <SettingsSection title={t("settings-product.privacy.board")}>
            <SettingsCard>
              <SettingSwitchRow
                title={t("settings-product.privacy.guests")}
                description={t("settings-product.privacy.guestsText")}
                checked={data?.features.allowAnonymous ?? false}
                disabled={locked}
                onCheckedChange={async (allowAnonymous) => {
                  await update.mutateAsync({ param, json: { allowAnonymous } });
                }}
              />
              <SettingsRow
                title={t("settings-product.privacy.moderate")}
                description={t("settings-product.privacy.moderateText")}
              >
                <SettingSelect
                  label={t("settings-product.privacy.moderate")}
                  value={
                    (data?.moderationDefault.requireApproval ??
                      "none") as Approval
                  }
                  options={approvals.map(([value, key]) => ({
                    value,
                    label: t(key),
                  }))}
                  disabled={locked}
                  onValueChange={async (requireApproval) => {
                    await moderation.mutateAsync({
                      param,
                      json: { requireApproval },
                    });
                  }}
                />
              </SettingsRow>
              {(
                [
                  [
                    "holdSpam",
                    t("settings-product.privacy.holdSpam"),
                    t("settings-product.privacy.holdSpamText"),
                  ],
                  [
                    "holdSensitive",
                    t("settings-product.privacy.holdSensitive"),
                    t("settings-product.privacy.holdSensitiveText"),
                  ],
                ] as const
              ).map(([key, title, description]) => (
                <SettingSwitchRow
                  key={key}
                  title={title}
                  description={description}
                  checked={data?.moderationDefault[key] ?? false}
                  disabled={locked}
                  onCheckedChange={async (value) => {
                    await moderation.mutateAsync({
                      param,
                      json: {
                        requireApproval: (data?.moderationDefault
                          .requireApproval ?? "none") as Approval,
                        [key]: value,
                      },
                    });
                  }}
                />
              ))}
            </SettingsCard>
          </SettingsSection>
          <SettingsSection title={t("settings-product.privacy.access")}>
            <SettingsCard>
              <SettingsRow
                title={t("settings-product.privacy.visibility")}
                description={t("settings-product.privacy.visibilityText")}
              >
                <SettingSelect
                  label={t("settings-product.privacy.visibility")}
                  value={visibility}
                  options={[
                    {
                      value: "public",
                      label: t("settings-product.privacy.public"),
                    },
                    {
                      value: "private",
                      label: t("settings-product.privacy.private"),
                    },
                  ]}
                  disabled={locked}
                  onValueChange={async (next) => {
                    await access.mutateAsync({
                      param,
                      json: { visibility: next },
                    });
                  }}
                />
              </SettingsRow>
              {visibility === "private" && locked ? (
                <SettingsRow
                  title={t("settings-product.privacy.domains")}
                  description={
                    data?.access.allowedDomains.join(", ") ||
                    t("settings-product.privacy.noDomains")
                  }
                />
              ) : null}
              {visibility === "private" && !locked ? (
                <DomainsForm
                  // The API lowercases the domains and drops invalid ones: show what it stored.
                  key={(data?.access.allowedDomains ?? []).join(",")}
                  domains={data?.access.allowedDomains ?? []}
                  onSubmit={(allowedDomains) =>
                    problemOf(
                      access.mutateAsync({
                        param,
                        json: { visibility, allowedDomains },
                      }),
                    )
                  }
                />
              ) : null}
            </SettingsCard>
            <SettingsNote>
              {t("settings-product.privacy.membersNote")}
            </SettingsNote>
          </SettingsSection>
          {data ? (
            <SignInSection
              workspaceId={workspaceId}
              locked={locked}
              data={data.signIn}
            />
          ) : null}
          <RetentionSection workspaceId={workspaceId} locked={locked} />
        </TeamStateView>
      </SettingsPage>
    </PageFrame>
  );
}
