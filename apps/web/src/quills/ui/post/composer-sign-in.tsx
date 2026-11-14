import { useTranslation } from "react-i18next";

export interface ComposerSignInProps {
  /** The sign-in page that returns to the composer. */
  href: string;
}

/** The composer's note that a visitor signs in to submit feedback. */
export function ComposerSignIn({ href }: ComposerSignInProps) {
  const { t } = useTranslation("quills");
  return (
    <p className="mt-2 border-t border-border pt-3 text-sm text-muted-foreground">
      {t("feedback.signInToSubmit")}{" "}
      <a
        className="font-medium text-foreground underline-offset-4 hover:underline"
        href={href}
      >
        {t("feedback.signIn")}
      </a>
    </p>
  );
}
