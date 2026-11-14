import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { FormSelect } from "../../../ui/form-select";
import { PortalForm } from "../../../ui/portal-form";

const schema = z.object({ statusOnTaskDone: z.string().nullable() });
export type TaskSyncValues = z.infer<typeof schema>;

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
      <h2 id="team-triage-task-sync-title" className="text-sm font-semibold">
        {t("task-sync.title")}
      </h2>
      <PortalForm<TaskSyncValues>
        schema={schema}
        defaultValues={{ statusOnTaskDone }}
        submitKey="task-sync.save"
        onSubmit={onSubmit}
      >
        {(form) => (
          <FormSelect
            control={form.control}
            name="statusOnTaskDone"
            label={t("task-sync.statusOnTaskDone")}
            options={[
              { value: null, label: t("task-sync.none") },
              ...statuses.map((status) => ({
                value: status.id,
                label: status.name,
              })),
            ]}
          />
        )}
      </PortalForm>
    </section>
  );
}
