import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { ArrowUpIcon } from "../../../ui/arrow-up-icon";
import { PortalForm } from "../../../ui/portal-form";
import { Textarea } from "../../../ui/upstream";
const schema = z.object({
  content: z.string().min(1).max(5000),
  parentId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});
export interface CreateCommentFormProps {
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function CreateCommentForm({ onSubmit }: CreateCommentFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ content: "" }}
      submitKey="post.submit"
      submitIcon={<ArrowUpIcon />}
      footer={() => null}
      className="max-w-none gap-1 rounded-xl border border-border bg-card px-4 py-2 shadow-xs focus-within:shadow-sm"
      onSubmit={onSubmit}
    >
      {(form) => (
        <>
          <Textarea
            unstyled
            className="text-sm [&_textarea]:min-h-10 [&_textarea]:px-0"
            aria-label={t("post.comment")}
            placeholder={t("post.commentPlaceholder")}
            {...form.register("content")}
            aria-invalid={Boolean(form.formState.errors.content)}
          />
          {form.formState.errors.content?.message ? (
            <p role="alert" className="text-xs text-destructive-foreground">
              {form.formState.errors.content.message}
            </p>
          ) : null}
        </>
      )}
    </PortalForm>
  );
}
