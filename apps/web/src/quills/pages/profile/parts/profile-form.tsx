import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Input, Field, FieldLabel } from "../../../ui/upstream";

const schema = z.object({ name: z.string().trim().min(2).max(100) });

export interface ProfileFormProps {
  initialName: string;
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}

export function ProfileForm({ initialName, onSubmit }: ProfileFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ name: initialName }}
      submitKey="profile.submit"
      onSubmit={onSubmit}
    >
      {(form) => (
        <>
          <Field invalid={Boolean(form.formState.errors.name)}>
            <FieldLabel htmlFor="profile-name">{t("profile.name")}</FieldLabel>
            <Input
              id="profile-name"
              autoComplete="name"
              {...form.register("name")}
            />
            {form.formState.errors.name?.message ? (
              <p role="alert">{form.formState.errors.name.message}</p>
            ) : null}
          </Field>
        </>
      )}
    </PortalForm>
  );
}
