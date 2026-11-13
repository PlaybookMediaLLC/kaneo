import { FeedbackEditor } from "../../../ui/feedback-editor";
import {
  useFeedbackAttachments,
  type FeedbackAttachment,
} from "../../../core/use-feedback-attachments";
import type { Viewer } from "../../../core/types";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Field, FieldLabel } from "../../../ui/upstream";
const schema = z.object({
  attachmentIds: z.array(z.string()).optional(),
  content: z.string().min(1).max(5000),
});
export interface EditCommentFormProps {
  content: string;
  workspaceId: string;
  viewer: Viewer;
  attachments?: FeedbackAttachment[];
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function EditCommentForm({
  content,
  onSubmit,
  workspaceId,
  viewer,
  attachments: initialAttachments,
}: EditCommentFormProps) {
  const attachments = useFeedbackAttachments(
    workspaceId,
    viewer,
    initialAttachments,
  );
  const { t } = useTranslation("quills");
  return (
    <PortalForm<z.infer<typeof schema>>
      schema={schema}
      defaultValues={{ content }}
      submitKey="post.saveComment"
      onSubmit={async (values) =>
        onSubmit({ ...values, attachmentIds: await attachments.upload() })
      }
    >
      {(form) => (
        <>
          <Field invalid={Boolean(form.formState.errors.content)}>
            <FieldLabel htmlFor="edit-comment">{t("post.comment")}</FieldLabel>
            <FeedbackEditor
              id="edit-comment"
              value={form.watch("content")}
              onChange={(value) =>
                form.setValue("content", value, { shouldDirty: true })
              }
              maxLength={5000}
              invalid={Boolean(form.formState.errors.content)}
              disabled={form.formState.isSubmitting}
              attachments={attachments.attachments}
              files={attachments.files}
              onFilesChange={attachments.setFiles}
              onRemove={attachments.remove}
              onRemoveFile={attachments.removeFile}
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
