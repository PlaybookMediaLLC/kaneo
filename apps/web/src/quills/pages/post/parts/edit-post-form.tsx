import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Input, Field, FieldLabel, Textarea } from "../../../ui/upstream";
const schema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(10000),
});
export interface EditPostFormProps {
  title: string;
  content: string;
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function EditPostForm({ title, content, onSubmit }: EditPostFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ title, content }}
      submitKey="post.savePost"
      onSubmit={onSubmit}
    >
      {(form) => (
        <>
          <Field invalid={Boolean(form.formState.errors.title)}>
            <FieldLabel htmlFor="edit-post-title">
              {t("feedback.postTitle")}
            </FieldLabel>
            <Input
              id="edit-post-title"
              {...form.register("title")}
              aria-invalid={Boolean(form.formState.errors.title)}
            />
            {form.formState.errors.title?.message ? (
              <p role="alert">{form.formState.errors.title.message}</p>
            ) : null}
          </Field>
          <Field invalid={Boolean(form.formState.errors.content)}>
            <FieldLabel htmlFor="edit-post-content">
              {t("feedback.content")}
            </FieldLabel>
            <Textarea
              id="edit-post-content"
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
