import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Field, FieldLabel, Input } from "../../../ui/upstream";

// The bounds of setQuillsPostScore. An empty field clears that input.
// The triage page has the same form; one shared copy can replace both after RFC 0004.
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
  { value: 0.25, labelKey: "team-post.impactMinimal" },
  { value: 0.5, labelKey: "team-post.impactLow" },
  { value: 1, labelKey: "team-post.impactMedium" },
  { value: 2, labelKey: "team-post.impactHigh" },
  { value: 3, labelKey: "team-post.impactMassive" },
] as const;
const numbers = [
  { name: "reach", labelKey: "team-post.reach" },
  { name: "confidence", labelKey: "team-post.confidence" },
  { name: "effort", labelKey: "team-post.effort" },
] as const;
const select =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

export interface ScoreFormProps {
  score: ScoreValues;
  onSubmit: (values: ScoreValues) => Promise<PortalProblem | void>;
}

/** The RICE inputs of a post, in the properties panel. */
export function ScoreForm({ score, onSubmit }: ScoreFormProps) {
  const { t } = useTranslation("quills");
  return (
    <PortalForm<ScoreValues>
      schema={schema}
      defaultValues={score}
      submitKey="team-post.saveScore"
      className="max-w-none gap-3"
      onSubmit={onSubmit}
    >
      {(form) => (
        <div className="grid grid-cols-2 gap-2">
          {numbers.map((field) => (
            <Field
              key={field.name}
              invalid={Boolean(form.formState.errors[field.name])}
            >
              <FieldLabel htmlFor={`team-post-${field.name}`}>
                {t(field.labelKey)}
              </FieldLabel>
              <Input
                id={`team-post-${field.name}`}
                size="sm"
                inputMode="decimal"
                {...form.register(field.name, { setValueAs: toNumber })}
                aria-invalid={Boolean(form.formState.errors[field.name])}
              />
              {form.formState.errors[field.name]?.message ? (
                <p role="alert">{form.formState.errors[field.name]!.message}</p>
              ) : null}
            </Field>
          ))}
          <Field>
            <FieldLabel htmlFor="team-post-impact">
              {t("team-post.impact")}
            </FieldLabel>
            <select
              id="team-post-impact"
              className={select}
              {...form.register("impact", { setValueAs: toNumber })}
            >
              <option value="">{t("team-post.notScored")}</option>
              {impacts.map((impact) => (
                <option key={impact.value} value={impact.value}>
                  {t(impact.labelKey)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </PortalForm>
  );
}
