import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Field, FieldLabel, Textarea } from "../../../ui/upstream";

const schema = z.object({
  content: z.string().trim().min(1).max(10000),
  idempotencyKey: z.string().min(8).max(128),
});
export interface NewConversationFormProps {
  idempotencyKey: string;
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function NewConversationForm(props: NewConversationFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ content: "", idempotencyKey: props.idempotencyKey }}
      submitKey="support.submit"
      onSubmit={props.onSubmit}
    >
      {(form) => (
        <>
          <input type="hidden" {...form.register("idempotencyKey")} />
          <Field invalid={Boolean(form.formState.errors.content)}>
            <FieldLabel htmlFor="support-content">
              {t("support.content")}
            </FieldLabel>
            <Textarea id="support-content" {...form.register("content")} />
            {form.formState.errors.content?.message ? (
              <p role="alert">{form.formState.errors.content.message}</p>
            ) : null}
          </Field>
        </>
      )}
    </PortalForm>
  );
}
