import type { ComponentProps } from "react";
import { useFeedbackAttachments } from "../core/use-feedback-attachments";
import { useCreatePortalPost } from "../hooks/feedback/use-create-portal-post";
import { AttachmentPicker } from "../ui/attachment-picker";
import { PostComposer } from "../ui/post/post-composer";
import { ImproveDraft } from "./improve-draft";
import { usePortalRuntime } from "./runtime";

export interface FeedbackComposerProps extends Omit<
  ComponentProps<typeof PostComposer>,
  "workspaceName" | "attachments" | "onSubmit"
> {
  workspaceId: string;
}

/** The inline composer that uploads chosen files, then creates the post. */
export function FeedbackComposer({
  workspaceId,
  ...props
}: FeedbackComposerProps) {
  const portal = usePortalRuntime();
  const create = useCreatePortalPost(portal.viewer);
  const files = useFeedbackAttachments(workspaceId, portal.viewer);
  return (
    <PostComposer
      {...props}
      workspaceName={portal.config.name}
      draftKey={`quills-feedback-draft:${workspaceId}:${portal.viewer.kind === "user" ? portal.viewer.id : "visitor"}`}
      attachments={(submitting) => (
        <AttachmentPicker
          attachments={files.attachments}
          files={files.files}
          disabled={submitting}
          onFilesChange={files.setFiles}
          onRemove={files.remove}
          onRemoveFile={files.removeFile}
        />
      )}
      assist={(draft, apply) => (
        <ImproveDraft
          workspaceId={workspaceId}
          viewer={portal.viewer}
          draft={draft}
          onApply={apply}
        />
      )}
      onSubmit={async (values) => {
        // A failed upload throws, so PortalForm offers a retry.
        const attachmentIds = await files.upload();
        try {
          await create.mutateAsync({
            param: { workspace: workspaceId },
            json: {
              ...values,
              idempotencyKey: files.idempotencyKey,
              attachmentIds,
            },
          });
          files.reset();
        } catch (problem) {
          return problem as never;
        }
      }}
    />
  );
}
