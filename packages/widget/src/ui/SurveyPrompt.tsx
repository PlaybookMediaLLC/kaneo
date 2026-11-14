import { useId, useState } from "react";
import { useAction } from "./useAction.js";
import type { SurveyAnswer, WidgetSurvey } from "./types.js";

/** One survey question on the home tab: a score scale, choices or a text answer. */
export function SurveyPrompt({
  survey,
  offline,
  onAnswer,
  onDismiss,
}: {
  survey: WidgetSurvey;
  offline: boolean;
  onAnswer: (answer: SurveyAnswer) => Promise<unknown>;
  onDismiss: () => void;
}) {
  const id = useId();
  const [answer, setAnswer] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const done = sent || !!survey.answered;
  const action = useAction();
  const { scale } = survey;
  const open = survey.type === "open";
  const answers = scale
    ? Array.from({ length: scale.max - scale.min + 1 }, (_, i) =>
        String(scale.min + i),
      )
    : survey.options;
  const text = comment.trim();
  const ready = open ? text !== "" : answer !== null;
  const send = () =>
    void action.run(async () => {
      await onAnswer({
        ...(scale ? { score: Number(answer) } : {}),
        ...(!scale && !open ? { choice: answer ?? "" } : {}),
        ...(text ? { comment: text } : {}),
      });
      setSent(true);
    });
  return (
    <section className="qb-contact-card qb-survey" aria-labelledby={id}>
      <h2 id={id}>{survey.question}</h2>
      {done ? (
        <p role="status">Thanks for your answer.</p>
      ) : (
        <>
          {!open && (
            <div
              className="qb-helpful-actions qb-survey-answers"
              role="group"
              aria-labelledby={id}
            >
              {answers.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={answer === value}
                  onClick={() => setAnswer(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
          <textarea
            aria-label={open ? "Your answer" : "Comment (optional)"}
            placeholder={open ? "Your answer" : "Add a comment (optional)"}
            rows={2}
            maxLength={2000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          {action.error && (
            <p className="qb-form-error" role="alert">
              {action.error}
            </p>
          )}
        </>
      )}
      <div className="qb-composer-actions">
        <button type="button" className="qb-text-button" onClick={onDismiss}>
          {done ? "Close" : "Not now"}
        </button>
        {!done && (
          <button
            type="button"
            className="qb-primary"
            disabled={!ready || offline || action.pending}
            onClick={send}
          >
            Send answer
          </button>
        )}
      </div>
    </section>
  );
}
