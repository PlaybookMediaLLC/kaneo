import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Field, FieldLabel } from "../../../ui/upstream";

const schema = z.object({ statusOnTaskDone: z.string().nullable() });
export type TaskSyncValues = z.infer<typeof schema>;
const select =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

export interface TaskSyncFormProps {
  statusOnTaskDone: string | null;
  statuses: { id: string; name: string }[];
  onSubmit: (values: TaskSyncValues) => Promise<PortalProblem | void>;
}

/** The status that a board's linked post gets when its Kaneo task is done (task sync). */
export function TaskSyncForm({
  statusOnTaskDone,
  statuses,
  onSubmit,
}: TaskSyncFormProps) {
  const { t } = useTranslation("quills");
  return (
    <section
      aria-labelledby="team-triage-task-sync-title"
      className="grid gap-2"
    >
      <h3 id="team-triage-task-sync-title" className="text-sm font-medium">
        {t("task-sync.title")}
      </h3>
      <PortalForm<TaskSyncValues>
        schema={schema}
        defaultValues={{ statusOnTaskDone }}
        submitKey="task-sync.save"
        onSubmit={onSubmit}
      >
        {(form) => (
          <Field>
            <FieldLabel htmlFor="team-triage-task-sync">
              {t("task-sync.statusOnTaskDone")}
            </FieldLabel>
            <select
              id="team-triage-task-sync"
              className={select}
              {...form.register("statusOnTaskDone", {
                setValueAs: (value: string | null) => value || null,
              })}
            >
              <option value="">{t("task-sync.none")}</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
            {form.formState.errors.statusOnTaskDone?.message ? (
              <p role="alert">
                {form.formState.errors.statusOnTaskDone.message}
              </p>
            ) : null}
          </Field>
        )}
      </PortalForm>
    </section>
  );
}
