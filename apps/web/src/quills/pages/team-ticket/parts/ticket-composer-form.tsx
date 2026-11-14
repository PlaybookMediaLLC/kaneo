import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Button, Field, FieldLabel, Textarea } from "../../../ui/upstream";

// The reply and note routes accept 1 to 4,000 characters.
const schema = z.object({ content: z.string().trim().min(1).max(4000) });

export interface TicketComposerFormProps {
  /** A reply goes to the requester; a note stays with the team. */
  mode: "reply" | "note";
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
  onCancel: () => void;
}

const copy = {
  reply: { label: "team-tickets.replyLabel", submit: "team-tickets.send" },
  note: { label: "team-tickets.noteLabel", submit: "team-tickets.saveNote" },
} as const;

/** The composer of a ticket reply or an internal note. */
export function TicketComposerForm({
  mode,
  onSubmit,
  onCancel,
}: TicketComposerFormProps) {
  const { t } = useTranslation("quills");
  const id = `team-ticket-${mode}`;
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ content: "" }}
      submitKey={copy[mode].submit}
      onSubmit={onSubmit}
      className="max-w-none border-t border-border px-4"
      footer={() => (
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("team-tickets.cancel")}
        </Button>
      )}
    >
      {(form) => (
        <Field invalid={Boolean(form.formState.errors.content)}>
          <FieldLabel htmlFor={id}>{t(copy[mode].label)}</FieldLabel>
          <Textarea
            id={id}
            // The teammate opened the composer with R or N, so the text field takes the focus.
            autoFocus
            rows={4}
            maxLength={4000}
            aria-invalid={Boolean(form.formState.errors.content)}
            {...form.register("content")}
          />
          {form.formState.errors.content?.message ? (
            <p role="alert">{String(form.formState.errors.content.message)}</p>
          ) : null}
        </Field>
      )}
    </PortalForm>
  );
}
