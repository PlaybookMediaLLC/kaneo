import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Field, FieldLabel } from "../../../ui/upstream";

const schema = z.object({
  voteDisplay: z.enum(["count", "hidden"]),
  defaultSort: z.enum(["votes", "newest", "random"]).nullable(),
});
export type BoardVotingValues = z.infer<typeof schema>;
const displays = [
  { value: "count", labelKey: "team-triage.voteDisplayCount" },
  { value: "hidden", labelKey: "team-triage.voteDisplayHidden" },
] as const;
const sorts = [
  { value: "", labelKey: "team-triage.sortDefault" },
  { value: "votes", labelKey: "team-triage.sortVotes" },
  { value: "newest", labelKey: "team-triage.sortNewest" },
  { value: "random", labelKey: "team-triage.sortRandom" },
] as const;
const select =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

export interface BoardVotingFormProps {
  settings: BoardVotingValues;
  onSubmit: (values: BoardVotingValues) => Promise<PortalProblem | void>;
}

/** How a board shows and orders votes on the portal (voting-bias controls). */
export function BoardVotingForm({ settings, onSubmit }: BoardVotingFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm<BoardVotingValues>
      schema={schema}
      defaultValues={settings}
      submitKey="team-triage.saveVoting"
      onSubmit={onSubmit}
    >
      {(form) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="team-triage-vote-display">
              {t("team-triage.voteDisplay")}
            </FieldLabel>
            <select
              id="team-triage-vote-display"
              className={select}
              {...form.register("voteDisplay")}
            >
              {displays.map((item) => (
                <option key={item.value} value={item.value}>
                  {t(item.labelKey)}
                </option>
              ))}
            </select>
            {form.formState.errors.voteDisplay?.message ? (
              <p role="alert">{form.formState.errors.voteDisplay.message}</p>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="team-triage-default-sort">
              {t("team-triage.defaultSort")}
            </FieldLabel>
            <select
              id="team-triage-default-sort"
              className={select}
              {...form.register("defaultSort", {
                setValueAs: (value: string | null) => value || null,
              })}
            >
              {sorts.map((item) => (
                <option key={item.value} value={item.value}>
                  {t(item.labelKey)}
                </option>
              ))}
            </select>
            {form.formState.errors.defaultSort?.message ? (
              <p role="alert">{form.formState.errors.defaultSort.message}</p>
            ) : null}
          </Field>
        </div>
      )}
    </PortalForm>
  );
}
