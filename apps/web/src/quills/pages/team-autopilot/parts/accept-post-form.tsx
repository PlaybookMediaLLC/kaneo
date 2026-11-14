import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { BoardSelect } from "../../../ui/post/board-select";
import { Input, Label } from "../../../ui/upstream";
const schema = z.object({
  boardId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});
export interface AcceptPostFormProps {
  boards: Array<{ id: string; name: string }>;
  /** The suggested title, which the teammate can edit. */
  title: string;
  onSubmit: (values: z.infer<typeof schema>) => Promise<PortalProblem | void>;
}
/** The board and the title of the post that a signal becomes. */
export function AcceptPostForm({
  boards,
  title,
  onSubmit,
}: AcceptPostFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ boardId: boards[0]?.id ?? "", title }}
      submitKey="autopilot.submit"
      onSubmit={onSubmit}
    >
      {(form) => (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="autopilot-post-title">
              {t("autopilot.postTitle")}
            </Label>
            <Input
              id="autopilot-post-title"
              maxLength={200}
              {...form.register("title")}
            />
            {form.formState.errors.title?.message ? (
              <p role="alert">{form.formState.errors.title.message}</p>
            ) : null}
          </div>
          <BoardSelect
            name="boardId"
            boards={boards}
            value={form.watch("boardId") || undefined}
            onChange={(boardId) =>
              form.setValue("boardId", boardId, { shouldDirty: true })
            }
          />
          {form.formState.errors.boardId?.message ? (
            <p role="alert">{form.formState.errors.boardId.message}</p>
          ) : null}
        </div>
      )}
    </PortalForm>
  );
}
