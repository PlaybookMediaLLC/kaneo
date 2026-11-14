import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Button, Field, FieldLabel, Textarea } from "../../../ui/upstream";

const schema = z.object({ content: z.string().trim().min(1).max(10000) });

export interface ComposerFormProps {
  /** A reply reaches the customer. A note stays inside the team. */
  mode: "reply" | "note";
  onSubmit: (content: string) => Promise<PortalProblem | void>;
  /** Runs while the teammate types a reply. */
  onTyping?: () => void;
  onCancel: () => void;
}

/** The reply and note composer. Ctrl or Cmd with Enter sends. */
export function ComposerForm({
  mode,
  onSubmit,
  onTyping,
  onCancel,
}: ComposerFormProps) {
  const { t } = useTranslation("quills");
  const id = `conversation-${mode}`;
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ content: "" }}
      submitKey={
        mode === "reply"
          ? "team-conversations.send"
          : "team-conversations.saveNote"
      }
      onSubmit={({ content }) => onSubmit(content)}
      className="max-w-none gap-3"
      footer={() => (
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("team-conversations.cancel")}
        </Button>
      )}
    >
      {(form) => {
        const field = form.register("content");
        return (
          <Field invalid={Boolean(form.formState.errors.content)}>
            <FieldLabel htmlFor={id}>
              {t(
                mode === "reply"
                  ? "team-conversations.replyLabel"
                  : "team-conversations.noteLabel",
              )}
            </FieldLabel>
            <Textarea
              id={id}
              autoFocus
              rows={4}
              aria-invalid={Boolean(form.formState.errors.content)}
              {...field}
              onChange={(event) => {
                void field.onChange(event);
                onTyping?.();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                  event.currentTarget.form?.requestSubmit();
              }}
            />
            {form.formState.errors.content?.message ? (
              <p role="alert" className="text-sm text-destructive">
                {String(form.formState.errors.content.message)}
              </p>
            ) : null}
          </Field>
        );
      }}
    </PortalForm>
  );
}
