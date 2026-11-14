import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Button, Field, FieldLabel, Textarea } from "../../../ui/upstream";

// The bounds of createQuillsComment.
const schema = z.object({ content: z.string().trim().min(1).max(5000) });
export type CommentValues = z.infer<typeof schema>;

const modes = {
  reply: { labelKey: "team-post.replyLabel", submitKey: "team-post.sendReply" },
  note: { labelKey: "team-post.noteLabel", submitKey: "team-post.saveNote" },
} as const;

export interface CommentFormProps {
  /** A reply is public on the portal; a note is visible to the team only. */
  mode: keyof typeof modes;
  onSubmit: (values: CommentValues) => Promise<PortalProblem | void>;
  onCancel: () => void;
}

/** The composer of a team reply or a private note. */
export function CommentForm({ mode, onSubmit, onCancel }: CommentFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm<CommentValues>
      schema={schema}
      defaultValues={{ content: "" }}
      submitKey={modes[mode].submitKey}
      className="max-w-none"
      onSubmit={onSubmit}
      footer={() => (
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("team-post.cancel")}
        </Button>
      )}
    >
      {(form) => (
        <Field invalid={Boolean(form.formState.errors.content)}>
          <FieldLabel htmlFor="team-post-comment">
            {t(modes[mode].labelKey)}
          </FieldLabel>
          <Textarea
            id="team-post-comment"
            autoFocus
            aria-invalid={Boolean(form.formState.errors.content)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
            }}
            {...form.register("content")}
          />
          {form.formState.errors.content?.message ? (
            <p role="alert">{form.formState.errors.content.message}</p>
          ) : null}
        </Field>
      )}
    </PortalForm>
  );
}
