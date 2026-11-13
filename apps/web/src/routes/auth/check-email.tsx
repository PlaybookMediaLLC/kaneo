import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import { authLinkClassName } from "@/components/auth/auth-link-class";
import { getSafeRedirectPath } from "@/components/auth/auth-methods";
import { AuthPage } from "@/components/auth/auth-page";
import PageTitle from "@/components/page-title";

export const Route = createFileRoute("/auth/check-email")({
  component: CheckEmail,
  validateSearch: (search: Record<string, unknown>) => ({
    email: search.email as string | undefined,
    redirect:
      typeof search.redirect === "string"
        ? getSafeRedirectPath(search.redirect)
        : undefined,
  }),
});

function CheckEmail() {
  const { t } = useTranslation();
  const { email, redirect } = useSearch({ from: "/auth/check-email" });

  return (
    <>
      <PageTitle title={t("auth:checkEmail.pageTitle")} />
      <AuthPage
        title={t("auth:checkEmail.title")}
        description={
          <Trans
            i18nKey="auth:checkEmail.inboxMessage"
            values={{ email: email || t("auth:checkEmail.emailFallback") }}
            components={{ email: <span className="text-foreground" /> }}
          />
        }
      >
        <p className="text-muted-foreground text-sm">
          <Link
            to="/auth/sign-in"
            search={{ redirect }}
            className={authLinkClassName}
          >
            {t("auth:checkEmail.backToLogin")}
          </Link>
        </p>
      </AuthPage>
    </>
  );
}
