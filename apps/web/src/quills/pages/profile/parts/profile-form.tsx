import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Input, Label } from "../../../ui/upstream";

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
        <div>
          <Label htmlFor="profile-name">{t("profile.name")}</Label>
          <Input
            id="profile-name"
            autoComplete="name"
            {...form.register("name")}
          />
          {form.formState.errors.name?.message ? (
            <p role="alert">{form.formState.errors.name.message}</p>
          ) : null}
        </div>
      )}
    </PortalForm>
  );
}
