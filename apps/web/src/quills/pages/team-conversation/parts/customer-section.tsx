import { useTranslation } from "react-i18next";
import { useGetUser } from "../../../hooks/team/use-get-user";
import { useGetUserCompany } from "../../../hooks/team/use-get-user-company";
import { useTeamRuntime } from "../../../team/runtime";
import { PropertyRow } from "../../../ui/inbox/property-row";

export interface CustomerSectionProps {
  workspaceId: string;
  principalId: string;
  /** The conversation's copy of the customer, shown when no profile loads. */
  name: string | null;
  email: string | null;
}

/** The customer and their company. An anonymous visitor has no profile, so only the conversation's name and email show. */
export function CustomerSection(props: CustomerSectionProps) {
  const { t, i18n } = useTranslation("quills");
  const team = useTeamRuntime();
  const user = useGetUser(
    {
      param: { workspaceId: props.workspaceId, principalId: props.principalId },
    },
    team.viewer,
  );
  const profile = user.data;
  const company = useGetUserCompany(
    {
      param: {
        workspaceId: profile?.companyId ? props.workspaceId : "",
        principalId: props.principalId,
      },
    },
    team.viewer,
  ).data?.company;
  const rows = [
    {
      key: "team-conversations.customer.name",
      value: profile?.name ?? props.name,
    },
    {
      key: "team-conversations.customer.email",
      value: profile?.email ?? profile?.contactEmail ?? props.email,
    },
    { key: "team-conversations.customer.country", value: profile?.country },
    { key: "team-conversations.customer.company", value: company?.name },
    { key: "team-conversations.customer.plan", value: company?.plan },
    {
      key: "team-conversations.customer.mrr",
      value:
        company?.mrrCents == null
          ? null
          : new Intl.NumberFormat(i18n.language, {
              maximumFractionDigits: 0,
            }).format(company.mrrCents / 100),
    },
  ];
  return (
    <section aria-labelledby="conversation-customer">
      <h2 id="conversation-customer" className="mb-1 text-sm font-semibold">
        {t("team-conversations.customer.title")}
      </h2>
      {rows
        .filter((row) => row.value)
        .map((row) => (
          <PropertyRow key={row.key} label={t(row.key)}>
            <span className="break-words">{row.value}</span>
          </PropertyRow>
        ))}
      {profile?.segments.length ? (
        <PropertyRow label={t("team-conversations.customer.segments")}>
          {profile.segments.map((segment) => segment.name).join(", ")}
        </PropertyRow>
      ) : null}
    </section>
  );
}
