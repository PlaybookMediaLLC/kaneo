import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { FormSelect } from "../../../ui/form-select";
import { PortalForm } from "../../../ui/portal-form";
import { Field, FieldLabel, Input } from "../../../ui/upstream";

// The bounds of setQuillsPostScore. An empty field clears that input.
const schema = z.object({
  reach: z.number().int().min(0).max(2147483647).nullable(),
  impact: z.union([
    z.literal(0.25),
    z.literal(0.5),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.null(),
  ]),
  confidence: z.number().int().min(0).max(100).nullable(),
  effort: z.number().min(0.01).max(10000).nullable(),
});
export type ScoreValues = z.infer<typeof schema>;
const toNumber = (value: unknown) =>
  value === "" || value === null ? null : Number(value);
const impacts = [
  { value: 0.25, labelKey: "team-triage.impactMinimal" },
  { value: 0.5, labelKey: "team-triage.impactLow" },
  { value: 1, labelKey: "team-triage.impactMedium" },
  { value: 2, labelKey: "team-triage.impactHigh" },
  { value: 3, labelKey: "team-triage.impactMassive" },
] as const;
const numbers = [
  { name: "reach", labelKey: "team-triage.reach" },
  { name: "confidence", labelKey: "team-triage.confidence" },
  { name: "effort", labelKey: "team-triage.effort" },
] as const;

export interface ScoreFormProps {
  score: ScoreValues;
  onSubmit: (values: ScoreValues) => Promise<PortalProblem | void>;
}

/** The RICE inputs of one request. */
export function ScoreForm({ score, onSubmit }: ScoreFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm<ScoreValues>
      schema={schema}
      defaultValues={score}
      submitKey="team-triage.saveScore"
      className="max-w-none"
      onSubmit={onSubmit}
    >
      {(form) => (
        <div className="grid gap-3 sm:grid-cols-4">
          {numbers.map((field) => (
            <Field
              key={field.name}
              invalid={Boolean(form.formState.errors[field.name])}
            >
              <FieldLabel htmlFor={`team-triage-${field.name}`}>
                {t(field.labelKey)}
              </FieldLabel>
              <Input
                id={`team-triage-${field.name}`}
                inputMode="decimal"
                {...form.register(field.name, { setValueAs: toNumber })}
                aria-invalid={Boolean(form.formState.errors[field.name])}
              />
              {form.formState.errors[field.name]?.message ? (
                <p role="alert">{form.formState.errors[field.name]!.message}</p>
              ) : null}
            </Field>
          ))}
          <FormSelect
            control={form.control}
            name="impact"
            label={t("team-triage.impact")}
            options={[
              { value: null, label: t("team-triage.unset") },
              ...impacts.map((impact) => ({
                value: impact.value,
                label: t(impact.labelKey),
              })),
            ]}
          />
        </div>
      )}
    </PortalForm>
  );
}
