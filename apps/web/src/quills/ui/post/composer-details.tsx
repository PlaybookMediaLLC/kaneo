import { useId, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "../upstream";

export type ComposerDetailsProps = ComponentProps<typeof Textarea>;

/** The details field of a composer, with a hint that asks for useful context. */
export function ComposerDetails(props: ComposerDetailsProps) {
  const { t } = useTranslation("quills");
  const hintId = useId();
  return (
    <>
      <Textarea
        unstyled
        className="text-sm text-muted-foreground [&_textarea]:resize-none"
        aria-label={t("feedback.content")}
        aria-describedby={hintId}
        placeholder={t("feedback.details")}
        {...props}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {t("feedback.detailsHint")}
      </p>
    </>
  );
}
