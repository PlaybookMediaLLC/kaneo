import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Field, FieldLabel, Textarea } from "../../../ui/upstream";
const schema = z.object({ content: z.string().min(1).max(5000) });
export interface EditCommentFormProps {
  content: string;
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function EditCommentForm({ content, onSubmit }: EditCommentFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ content }}
      submitKey="post.saveComment"
      onSubmit={onSubmit}
    >
      {(form) => (
        <>
          <Field invalid={Boolean(form.formState.errors.content)}>
            <FieldLabel htmlFor="edit-comment">{t("post.comment")}</FieldLabel>
            <Textarea
              id="edit-comment"
              {...form.register("content")}
              aria-invalid={Boolean(form.formState.errors.content)}
            />
            {form.formState.errors.content?.message ? (
              <p role="alert">{form.formState.errors.content.message}</p>
            ) : null}
          </Field>
        </>
      )}
    </PortalForm>
  );
}
