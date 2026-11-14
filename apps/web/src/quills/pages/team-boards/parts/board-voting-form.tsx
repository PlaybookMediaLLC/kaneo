import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { FormSelect } from "../../../ui/form-select";
import { PortalForm } from "../../../ui/portal-form";

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
  { value: null, labelKey: "team-triage.sortDefault" },
  { value: "votes", labelKey: "team-triage.sortVotes" },
  { value: "newest", labelKey: "team-triage.sortNewest" },
  { value: "random", labelKey: "team-triage.sortRandom" },
] as const;

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
          <FormSelect
            control={form.control}
            name="voteDisplay"
            label={t("team-triage.voteDisplay")}
            options={displays.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
          />
          <FormSelect
            control={form.control}
            name="defaultSort"
            label={t("team-triage.defaultSort")}
            options={sorts.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
          />
        </div>
      )}
    </PortalForm>
  );
}
