import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { PortalSelectContent } from "../../../ui/portal-select-content";
import { SURVEY_TYPE_KEYS, type SurveyType } from "../../../ui/survey-labels";
import {
  Field,
  FieldLabel,
  Input,
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "../../../ui/upstream";

const types = Object.keys(SURVEY_TYPE_KEYS) as [SurveyType, ...SurveyType[]];
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
/** A poll needs 2 to 20 different answers of at most 200 characters. */
const pollAnswersFit = (answers: string[]) =>
  answers.length >= 2 &&
  answers.length <= 20 &&
  new Set(answers).size === answers.length &&
  answers.every((answer) => answer.length <= 200);

/** The create body of the API: a poll sends its answers, other types send none. */
export interface CreateSurveyValues {
  type: SurveyType;
  question: string;
  options?: string[];
}

export interface CreateSurveyFormProps {
  onSubmit: (values: CreateSurveyValues) => Promise<PortalProblem | void>;
}

export function CreateSurveyForm({ onSubmit }: CreateSurveyFormProps) {
  const { t } = useTranslation("quills");
  const schema = z
    .object({
      type: z.enum(types),
      question: z
        .string()
        .trim()
        .min(1, t("surveys.create.questionRequired"))
        .max(500),
      options: z.string().max(4400),
    })
    .refine(
      (values) =>
        values.type !== "poll" || pollAnswersFit(lines(values.options)),
      { path: ["options"], message: t("surveys.create.optionsRequired") },
    );
  const error = (message: unknown) =>
    message ? (
      <p role="alert" className="text-xs text-destructive-foreground">
        {String(message)}
      </p>
    ) : null;
  return (
    <PortalForm
      schema={schema}
      defaultValues={{ type: "nps", question: "", options: "" }}
      submitKey="surveys.create.submit"
      onSubmit={({ type, question, options }) =>
        onSubmit({
          type,
          question,
          ...(type === "poll" && { options: lines(options) }),
        })
      }
    >
      {(form) => {
        const type = form.watch("type");
        return (
          <>
            <Field>
              <FieldLabel htmlFor="team-surveys-type">
                {t("surveys.create.type")}
              </FieldLabel>
              <Select
                items={types.map((value) => ({
                  value,
                  label: t(SURVEY_TYPE_KEYS[value]),
                }))}
                value={type}
                onValueChange={(value) => {
                  if (value) form.setValue("type", value);
                }}
              >
                <SelectTrigger id="team-surveys-type">
                  <SelectValue />
                </SelectTrigger>
                <PortalSelectContent>
                  <SelectGroup>
                    {types.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(SURVEY_TYPE_KEYS[value])}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </PortalSelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="team-surveys-question">
                {t("surveys.create.question")}
              </FieldLabel>
              <Input
                id="team-surveys-question"
                maxLength={500}
                {...form.register("question")}
              />
              {error(form.formState.errors.question?.message)}
            </Field>
            {type === "poll" ? (
              <Field>
                <FieldLabel htmlFor="team-surveys-options">
                  {t("surveys.create.options")}
                </FieldLabel>
                <Textarea
                  id="team-surveys-options"
                  rows={4}
                  {...form.register("options")}
                />
                {error(form.formState.errors.options?.message)}
              </Field>
            ) : null}
          </>
        );
      }}
    </PortalForm>
  );
}
