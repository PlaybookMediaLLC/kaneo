import { useTranslation } from "react-i18next";
import type { GetCustomerProfileResponse } from "../../../api/portal/get-customer-profile";
import type { GetPublicUserProfileResponse } from "../../../api/portal/get-public-user-profile";
import { Card, CardContent, CardHeader, CardTitle } from "../../../ui/upstream";

export interface ProfileSummaryProps {
  account: GetCustomerProfileResponse;
  publicProfile?: GetPublicUserProfileResponse;
}

export function ProfileSummary({
  account,
  publicProfile,
}: ProfileSummaryProps) {
  const { t } = useTranslation("quills");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{account.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{t("profile.email", { email: account.email })}</p>
        {publicProfile ? (
          <section aria-label={t("profile.activity")}>
            {publicProfile.isTeamMember ? (
              <p>{t("profile.teamMember")}</p>
            ) : null}
            <p>{t("profile.posts", { count: publicProfile.postCount })}</p>
            <p>
              {t("profile.comments", { count: publicProfile.commentCount })}
            </p>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
