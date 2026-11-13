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
import { Input, Field, FieldLabel } from "../../../ui/upstream";
const schema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(10000),
  attachmentIds: z.array(z.string()).optional(),
});
export interface EditPostFormProps {
  title: string;
  content: string;
  workspaceId: string;
  viewer: Viewer;
  attachments?: FeedbackAttachment[];
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function EditPostForm({
  title,
  content,
  onSubmit,
  workspaceId,
  viewer,
  attachments: initialAttachments,
}: EditPostFormProps) {
  const attachments = useFeedbackAttachments(
    workspaceId,
    viewer,
    initialAttachments,
  );
  const { t } = useTranslation("quills");
  return (
    <PortalForm<z.infer<typeof schema>>
      schema={schema}
      defaultValues={{ title, content }}
      submitKey="post.savePost"
      onSubmit={async (values) =>
        onSubmit({ ...values, attachmentIds: await attachments.upload() })
      }
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
            <FeedbackEditor
              id="edit-post-content"
              value={form.watch("content")}
              onChange={(value) =>
                form.setValue("content", value, { shouldDirty: true })
              }
              maxLength={10000}
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
