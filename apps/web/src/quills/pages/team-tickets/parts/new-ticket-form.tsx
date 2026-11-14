import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Textarea,
} from "../../../ui/upstream";

// The create route accepts a title of 1 to 300 and details of up to 4,000 characters.
const schema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000),
});
export type NewTicketValues = z.infer<typeof schema>;

export interface NewTicketFormProps {
  onSubmit: (values: NewTicketValues) => Promise<PortalProblem | void>;
  onCancel: () => void;
}

/** The title and the details of a new ticket. */
export function NewTicketForm({ onSubmit, onCancel }: NewTicketFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ title: "", description: "" }}
      submitKey="team-tickets.new.create"
      onSubmit={onSubmit}
      className="max-w-none gap-3"
      footer={() => (
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("team-tickets.cancel")}
        </Button>
      )}
    >
      {(form) => (
        <>
          <Field invalid={Boolean(form.formState.errors.title)}>
            <FieldLabel htmlFor="new-ticket-title">
              {t("team-tickets.new.titleLabel")}
            </FieldLabel>
            <Input
              id="new-ticket-title"
              maxLength={300}
              aria-invalid={Boolean(form.formState.errors.title)}
              {...form.register("title")}
            />
            {form.formState.errors.title?.message ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {String(form.formState.errors.title.message)}
              </p>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="new-ticket-description">
              {t("team-tickets.new.details")}
            </FieldLabel>
            <Textarea
              id="new-ticket-description"
              rows={6}
              maxLength={4000}
              {...form.register("description")}
            />
          </Field>
        </>
      )}
    </PortalForm>
  );
}
