import { useId } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../core/types";
import { PortalForm } from "./portal-form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Field,
  FieldLabel,
  Textarea,
} from "./upstream";

export interface SurveyCardProps {
  survey: {
    type: string;
    question: string;
    options: string[];
    scale: { min: number; max: number } | null;
  };
  /** The answer was sent: show the thanks state. */
  done: boolean;
  /** The answer that the API takes: a score, a choice or only a comment. */
  onSubmit: (answer: {
    score?: number;
    choice?: string;
    comment?: string;
  }) => Promise<PortalProblem | void>;
  /** Hides the survey for this session. */
  onDismiss: () => void;
}

const option =
  "inline-flex min-w-9 cursor-pointer items-center justify-center rounded-md border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring";

/** One survey question with a score scale, choices or a text answer, and an optional comment. */
export function SurveyCard({
  survey,
  done,
  onSubmit,
  onDismiss,
}: SurveyCardProps) {
  const { t } = useTranslation("quills");
  const id = useId();
  const open = survey.type === "open";
  const { scale } = survey;
  const answers = scale
    ? Array.from({ length: scale.max - scale.min + 1 }, (_, i) =>
        String(scale.min + i),
      )
    : survey.options;
  const schema = z
    .object({ answer: z.string(), comment: z.string().trim().max(2000) })
    .refine((values) => Boolean(open ? values.comment : values.answer), {
      path: [open ? "comment" : "answer"],
      message: t(open ? "surveys.card.writeAnswer" : "surveys.card.required"),
    });
  const dismiss = (
    <Button type="button" variant="ghost" onClick={onDismiss}>
      {t("surveys.card.dismiss")}
    </Button>
  );
  return (
    <Card
      render={<section />}
      aria-labelledby={`${id}-question`}
      className="shadow-none"
    >
      <CardHeader>
        <h2 id={`${id}-question`} className="text-lg font-semibold">
          {survey.question}
        </h2>
      </CardHeader>
      <CardContent>
        {done ? (
          <div className="flex items-center justify-between gap-4">
            <p role="status">{t("surveys.card.thanks")}</p>
            {dismiss}
          </div>
        ) : (
          <PortalForm
            schema={schema}
            defaultValues={{ answer: "", comment: "" }}
            submitKey="surveys.card.submit"
            className="py-0"
            footer={() => dismiss}
            onSubmit={({ answer, comment }) =>
              onSubmit({
                ...(scale && { score: Number(answer) }),
                ...(!scale && !open && { choice: answer }),
                ...(comment && { comment }),
              })
            }
          >
            {(form) => {
              const problem =
                form.formState.errors.answer?.message ??
                form.formState.errors.comment?.message;
              return (
                <>
                  {open ? null : (
                    <div
                      role="radiogroup"
                      aria-labelledby={`${id}-question`}
                      className="flex flex-wrap gap-2"
                    >
                      {answers.map((value) => (
                        <label key={value} className={option}>
                          <input
                            type="radio"
                            className="sr-only"
                            value={value}
                            {...form.register("answer")}
                          />
                          {value}
                        </label>
                      ))}
                    </div>
                  )}
                  <Field>
                    <FieldLabel htmlFor={`${id}-comment`}>
                      {t(
                        open
                          ? "surveys.card.openAnswer"
                          : "surveys.card.comment",
                      )}
                    </FieldLabel>
                    <Textarea
                      id={`${id}-comment`}
                      rows={2}
                      maxLength={2000}
                      {...form.register("comment")}
                    />
                  </Field>
                  {problem ? (
                    <p
                      role="alert"
                      className="text-xs text-destructive-foreground"
                    >
                      {String(problem)}
                    </p>
                  ) : null}
                </>
              );
            }}
          </PortalForm>
        )}
      </CardContent>
    </Card>
  );
}
