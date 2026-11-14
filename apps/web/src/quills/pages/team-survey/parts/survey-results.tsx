import { useTranslation } from "react-i18next";
import type { GetSurveyResultsResponse } from "../../../api/team/get-survey-results";
import { SurveyBars } from "./survey-bars";

export interface SurveyResultsProps {
  results: GetSurveyResultsResponse;
}

const SCORE_KEYS = {
  nps: "surveys.results.score.nps",
  csat: "surveys.results.score.csat",
  ces: "surveys.results.score.ces",
  pmf: "surveys.results.score.pmf",
} as const;
const heading = "text-sm font-semibold";
const muted = "text-sm text-muted-foreground";

/** The results of one survey: the score, a bar for each answer and the latest comments. */
export function SurveyResults({ results }: SurveyResultsProps) {
  const { t } = useTranslation("quills");
  const { survey } = results;
  const scoreKey =
    survey.type in SCORE_KEYS
      ? SCORE_KEYS[survey.type as keyof typeof SCORE_KEYS]
      : null;
  const rows = [
    ...results.scores.map((s) => ({ label: String(s.value), count: s.count })),
    ...results.choices,
  ];
  return (
    <div className="grid gap-6">
      {scoreKey ? (
        <p className="text-2xl font-semibold">
          {results.score === null
            ? t("surveys.results.noScore")
            : t(scoreKey, { score: results.score })}
        </p>
      ) : null}
      {rows.length ? (
        <section aria-labelledby="team-survey-answers">
          <h2 id="team-survey-answers" className={heading}>
            {t("surveys.results.answers")}
          </h2>
          <SurveyBars rows={rows} total={results.total} />
        </section>
      ) : null}
      <section aria-labelledby="team-survey-comments">
        <h2 id="team-survey-comments" className={heading}>
          {t("surveys.results.comments")}
        </h2>
        {results.comments.length ? (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {results.comments.map((comment) => (
              <li key={comment.id} className="px-4 py-3">
                <p>{comment.comment}</p>
                <p className={muted}>
                  {comment.respondent ?? t("surveys.results.person")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 ${muted}`}>{t("surveys.results.noComments")}</p>
        )}
      </section>
    </div>
  );
}
