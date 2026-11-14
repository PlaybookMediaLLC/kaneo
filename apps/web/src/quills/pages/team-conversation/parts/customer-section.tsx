import { useTranslation } from "react-i18next";
import { useGetUser } from "../../../hooks/team/use-get-user";
import { useGetUserCompany } from "../../../hooks/team/use-get-user-company";
import { useTeamRuntime } from "../../../team/runtime";
import { PropertyRow } from "../../../ui/inbox/property-row";
import { PersonAvatar } from "../../../ui/person-avatar";

export interface CustomerSectionProps {
  workspaceId: string;
  principalId: string;
  /** The conversation's copy of the customer, shown when no profile loads. */
  name: string | null;
  email: string | null;
}

/**
 * The top of the right panel: a large avatar, the name and the email, then the company and
 * the segments. An anonymous visitor has no profile, so only the conversation's name and
 * email show.
 */
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
  const name = profile?.name ?? props.name ?? t("team-conversations.unknown");
  const email = profile?.email ?? profile?.contactEmail ?? props.email;
  const rows = [
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
    { key: "team-conversations.customer.country", value: profile?.country },
    {
      key: "team-conversations.customer.segments",
      value: profile?.segments.map((segment) => segment.name).join(", "),
    },
  ];
  return (
    <section aria-labelledby="conversation-customer" className="grid gap-3">
      <div className="flex flex-col items-center gap-1 text-center">
        <PersonAvatar
          colored
          name={name}
          avatarUrl={profile?.image}
          className="mb-1 size-16 text-lg"
        />
        <h2 id="conversation-customer" className="font-semibold">
          {name}
        </h2>
        {email ? (
          <p className="break-all text-sm text-muted-foreground">{email}</p>
        ) : null}
      </div>
      <div>
        {rows
          .filter((row) => row.value)
          .map((row) => (
            <PropertyRow key={row.key} label={t(row.key)}>
              <span className="break-words">{row.value}</span>
            </PropertyRow>
          ))}
      </div>
    </section>
  );
}
