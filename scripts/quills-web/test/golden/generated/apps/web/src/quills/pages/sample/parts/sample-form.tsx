import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Input, Label } from "../../../ui/upstream";
const schema = z.object({
  boardId: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(10000),
  idempotencyKey: z.string().min(1).max(128).optional(),
});
export interface SampleFormProps {
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
export function SampleForm({ onSubmit }: SampleFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ content: "value" }}
      submitKey="sample.submit"
      onSubmit={onSubmit}
    >
      {(form) => (
        <div>
          <Label htmlFor="sample-board-id">{t("sample.boardId")}</Label>
          <Input id="sample-board-id" {...form.register("boardId")} />
          {form.formState.errors.boardId?.message ? (
            <p role="alert">{form.formState.errors.boardId.message}</p>
          ) : null}
        </div>
      )}
    </PortalForm>
  );
}
