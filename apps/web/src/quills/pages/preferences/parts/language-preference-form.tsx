import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Input, Field, FieldLabel } from "../../../ui/upstream";

const schema = z.object({
  language: z
    .string()
    .max(35)
    .regex(/^$|^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
});
export interface LanguagePreferenceFormProps {
  initialLanguage: string | null;
  onSubmit: (values: {
    language: string | null;
  }) => Promise<PortalProblem | void>;
}

export function LanguagePreferenceForm(props: LanguagePreferenceFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ language: props.initialLanguage ?? "" }}
      submitKey="preferences.submit"
      onSubmit={({ language }) =>
        props.onSubmit({ language: language || null })
      }
    >
      {(form) => (
        <>
          <Field invalid={Boolean(form.formState.errors.language)}>
            <FieldLabel htmlFor="preference-language">
              {t("preferences.language")}
            </FieldLabel>
            <Input
              id="preference-language"
              autoComplete="language"
              {...form.register("language")}
            />
            <p>{t("preferences.languageHint")}</p>
            {form.formState.errors.language?.message ? (
              <p role="alert">
                {String(form.formState.errors.language.message)}
              </p>
            ) : null}
          </Field>
        </>
      )}
    </PortalForm>
  );
}
