import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Field, FieldLabel, Input } from "../../../ui/upstream";

const schema = z.object({ name: z.string().trim().min(1).max(80) });
export type SaveViewValues = z.infer<typeof schema>;

export interface SaveViewFormProps {
  onSubmit: (values: SaveViewValues) => Promise<PortalProblem | void>;
}

/** The name of a new conversation view. */
export function SaveViewForm({ onSubmit }: SaveViewFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ name: "" }}
      submitKey="team-conversations.saveView.submit"
      className="max-w-none gap-3"
      onSubmit={onSubmit}
    >
      {(form) => (
        <Field invalid={Boolean(form.formState.errors.name)}>
          <FieldLabel htmlFor="conversation-view-name">
            {t("team-conversations.saveView.name")}
          </FieldLabel>
          <Input
            id="conversation-view-name"
            maxLength={80}
            autoFocus
            aria-invalid={Boolean(form.formState.errors.name)}
            {...form.register("name")}
          />
          {form.formState.errors.name?.message ? (
            <p role="alert" className="text-sm text-destructive">
              {String(form.formState.errors.name.message)}
            </p>
          ) : null}
        </Field>
      )}
    </PortalForm>
  );
}
