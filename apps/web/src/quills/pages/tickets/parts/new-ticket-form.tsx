import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Input, Label, Textarea } from "../../../ui/upstream";

const schema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).optional(),
});
export interface NewTicketFormProps {
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function NewTicketForm({ onSubmit }: NewTicketFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ title: "", description: "" }}
      submitKey="tickets.submit"
      onSubmit={onSubmit}
    >
      {(form) => (
        <div>
          <Label htmlFor="ticket-title">{t("tickets.ticketTitle")}</Label>
          <Input id="ticket-title" {...form.register("title")} />
          {form.formState.errors.title?.message ? (
            <p role="alert">{form.formState.errors.title.message}</p>
          ) : null}
          <Label htmlFor="ticket-description">{t("tickets.description")}</Label>
          <Textarea id="ticket-description" {...form.register("description")} />
          {form.formState.errors.description?.message ? (
            <p role="alert">{form.formState.errors.description.message}</p>
          ) : null}
        </div>
      )}
    </PortalForm>
  );
}
