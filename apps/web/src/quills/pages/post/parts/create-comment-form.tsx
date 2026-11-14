import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { PortalProblem, Viewer } from "../../../core/types";
import { useFeedbackAttachments } from "../../../core/use-feedback-attachments";
import { ArrowUpIcon } from "../../../ui/arrow-up-icon";
import { AttachmentPicker } from "../../../ui/attachment-picker";
import { PortalForm } from "../../../ui/portal-form";
import { Textarea } from "../../../ui/upstream";
const schema = z.object({
  attachmentIds: z.array(z.string()).optional(),
  content: z.string().min(1).max(5000),
  parentId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});
export interface CreateCommentFormProps {
  workspaceId: string;
  viewer: Viewer;
  autoFocus?: boolean;
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function CreateCommentForm({
  workspaceId,
  viewer,
  autoFocus,
  onSubmit,
}: CreateCommentFormProps) {
  const { t } = useTranslation("quills");
  const attachments = useFeedbackAttachments(workspaceId, viewer);
  return (
    <PortalForm<z.infer<typeof schema>>
      schema={schema}
      defaultValues={{ content: "" }}
      submitKey="post.submit"
      submitIcon={<ArrowUpIcon />}
      resetOnSuccess
      footer={(form) => (
        <AttachmentPicker
          attachments={attachments.attachments}
          files={attachments.files}
          disabled={form.formState.isSubmitting}
          onFilesChange={attachments.setFiles}
          onRemove={attachments.remove}
          onRemoveFile={attachments.removeFile}
        />
      )}
      className="max-w-none gap-1 rounded-xl border border-border bg-card px-4 py-2 shadow-xs focus-within:shadow-sm"
      onSubmit={async (values) => {
        const result = await onSubmit({
          ...values,
          idempotencyKey: attachments.idempotencyKey,
          attachmentIds: await attachments.upload(),
        });
        if (!result) attachments.reset();
        return result;
      }}
    >
      {(form) => (
        <>
          <Textarea
            unstyled
            className="text-sm [&_textarea]:min-h-10 [&_textarea]:resize-none [&_textarea]:px-0"
            autoFocus={autoFocus}
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
